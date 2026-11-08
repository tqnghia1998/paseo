import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  CHIEF_PERSONA,
  CHIEF_TOOLS,
  ChiefProviderUnavailableError,
  createChiefSession,
} from "./chief-session.js";
import type { AgentSessionConfig } from "../../server/agent/agent-sdk-types.js";
import type { CreateAgentOptions } from "../../server/agent/agent-manager.js";

interface FixtureAgent {
  id: string;
  config: AgentSessionConfig;
  cwd: string;
  provider: string;
  workspaceId?: string;
  background?: boolean;
  capabilities: { supportsMcpServers: boolean };
}
interface FixtureWorkspace {
  workspaceId: string;
  cwd: string;
  background: boolean;
  archivedAt: null;
}

const homes: string[] = [];
const services: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "chief-session-"));
  homes.push(home);
  const records = new Map<string, FixtureAgent>();
  const workspaces = new Map<string, FixtureWorkspace>();
  const manager = {
    createAgent: vi.fn(
      async (config: AgentSessionConfig, id: string, options: CreateAgentOptions) => {
        const agent = {
          id,
          config,
          cwd: config.cwd,
          provider: config.provider,
          ...options,
          capabilities: { supportsMcpServers: true },
        };
        records.set(id, agent);
        return agent;
      },
    ),
    flush: vi.fn(async () => {}),
    getAgent: vi.fn((id: string) => records.get(id) ?? null),
    getProviderAvailability: vi.fn(async (provider: string) => ({
      provider,
      available: true,
      error: null,
    })),
    updateAgentMetadata: vi.fn(async () => {}),
    reloadAgentSession: vi.fn(async (id: string, config: AgentSessionConfig) => {
      const agent = records.get(id)!;
      agent.config = config;
      return agent;
    }),
  };
  const workdir = path.join(home, "work");
  const dependencies = {
    home,
    workdir,
    serverId: "fixture-server",
    agentManager: manager,
    agentStorage: {
      get: async (id: string) => records.get(id) ?? null,
      listAll: async () => [...records.values()],
    },
    workspaceRegistry: { get: async (id: string) => workspaces.get(id) ?? null },
    createWorkspace: vi.fn(async (cwd: string, id: string) => {
      const workspace = { workspaceId: id, cwd, background: true, archivedAt: null };
      workspaces.set(id, workspace);
      return workspace;
    }),
    loadAgent: vi.fn(async (id: string) => records.get(id)),
    prepareBot: vi.fn(async () => "Managed Chief memory and instructions"),
    deleteAgent: vi.fn(async (id: string) => {
      records.delete(id);
    }),
  };
  const service = createChiefSession(
    dependencies as unknown as Parameters<typeof createChiefSession>[0],
  );
  services.push(service);
  await service.initialize();
  return { home, workdir, records, manager, dependencies, service, workspaces };
}

const URL_A = "http://127.0.0.1:7777/api/chief/mcp";

test("the first connection creates one durable background plain agent in the working folder", async () => {
  const { service, manager, workdir } = await fixture();
  expect(service.isConnected()).toBe(false);
  const [a, b] = await Promise.all([service.connect(URL_A), service.connect(URL_A)]);
  expect(a).toEqual(b);
  expect(service.isConnected()).toBe(true);
  expect(a).toMatchObject({
    protocol: 1,
    status: "ready",
    policy: "chief-v1",
    provider: "claude",
    cwd: workdir,
  });
  expect(manager.createAgent).toHaveBeenCalledTimes(1);
  const [config, id, options] = manager.createAgent.mock.calls[0]!;
  expect(config).toMatchObject({ provider: "claude", model: "sonnet", cwd: workdir });
  // A plain agent: full access, and not restricted to its own MCP server.
  expect(config.modeId).toBe("bypassPermissions");
  expect(config.providerOptions?.restrictToConfiguredMcp).toBeUndefined();
  expect(options).toMatchObject({ background: true, workspaceId: a.workspaceId });
  expect(config.internal).not.toBe(true);
  expect(options.labels?.["paseo-bots.bot"]).toBe("vibing-chief");
  expect(config.systemPrompt).toContain("Managed Chief memory and instructions");
  expect(config.mcpServers?.chief).toMatchObject({ type: "http", url: URL_A });
  expect(service.owns(id)).toBe(true);
  expect(service.owns("ordinary-agent")).toBe(false);
  expect(JSON.stringify(config)).not.toContain("cleanup");
});

test("the working folder is created when missing and need not be private or free of Git", async () => {
  const { service, workdir } = await fixture();
  await fs.mkdir(path.join(workdir, ".git"), { recursive: true });
  await service.connect(URL_A);
  expect((await fs.stat(workdir)).isDirectory()).toBe(true);
});

test("a daemon restart finds the same Chief and loads the same agent", async () => {
  const { service, dependencies, manager } = await fixture();
  const first = await service.connect(URL_A);
  await service.close();
  const restarted = createChiefSession(dependencies as never);
  services.push(restarted);
  await restarted.initialize();
  expect(restarted.owns(first.agentId)).toBe(true);
  expect(await restarted.connect("http://127.0.0.1:8888/api/chief/mcp")).toEqual(first);
  expect(manager.createAgent).toHaveBeenCalledTimes(1);
  expect(dependencies.loadAgent).toHaveBeenCalledWith(first.agentId);
});

test("the user's model and mode survive a rebind, and the host's own parts are put back", async () => {
  const { service, records, dependencies, manager } = await fixture();
  const first = await service.connect(URL_A);
  const agent = records.get(first.agentId)!;
  agent.config = { ...agent.config, model: "opus", modeId: "default" };
  // The daemon came back on another port: the host's tool address must follow it.
  const revived = createChiefSession(dependencies as never);
  services.push(revived);
  await service.close();
  await revived.initialize();
  await revived.connect("http://127.0.0.1:8888/api/chief/mcp");
  expect(manager.reloadAgentSession).toHaveBeenCalledTimes(1);
  const reloaded = manager.reloadAgentSession.mock.calls[0]![1];
  expect(reloaded.model).toBe("opus");
  expect(reloaded.modeId).toBe("default");
  expect(reloaded.mcpServers?.chief).toMatchObject({ url: "http://127.0.0.1:8888/api/chief/mcp" });
});

test("a user MCP server on Chief's agent is kept, but never replaces Chief's own tools", async () => {
  const { service, records } = await fixture();
  const first = await service.connect(URL_A);
  const candidate = {
    ...records.get(first.agentId)!.config,
    mcpServers: {
      seatalk: { type: "stdio" as const, command: "seatalk-mcp", args: [] },
      chief: { type: "http" as const, url: "http://evil.example/mcp" },
    },
  };
  const sealed = service.seal(first.agentId, candidate as AgentSessionConfig)!;
  expect(sealed.mcpServers?.seatalk).toBeDefined();
  expect(sealed.mcpServers?.chief).toMatchObject({ url: URL_A });
});

test("an agent that is not Chief's is left alone by the seal", async () => {
  const { service, records } = await fixture();
  const first = await service.connect(URL_A);
  const candidate = records.get(first.agentId)!.config;
  expect(service.seal("some-other-agent", candidate)).toBeNull();
  expect(service.owns("some-other-agent")).toBe(false);
});

test("a restart starts a fresh agent under the same workspace and deletes the old one", async () => {
  const { service, records, manager, dependencies } = await fixture();
  const first = await service.connect(URL_A);
  const second = await service.restart();
  expect(second.agentId).not.toBe(first.agentId);
  expect(second).toMatchObject({ workspaceId: first.workspaceId, cwd: first.cwd, status: "ready" });
  expect(manager.createAgent).toHaveBeenCalledTimes(2);
  expect(dependencies.deleteAgent).toHaveBeenCalledWith(first.agentId);
  expect(records.has(first.agentId)).toBe(false);
  expect(records.has(second.agentId)).toBe(true);
  expect(service.agentId()).toBe(second.agentId);
  expect(service.isConnected()).toBe(true);
});

test("an agent a restart replaced can never be sealed or resumed, even when its deletion fails", async () => {
  const { service, records, dependencies, manager } = await fixture();
  const first = await service.connect(URL_A);
  const oldConfig = manager.createAgent.mock.calls[0]![0];
  dependencies.deleteAgent.mockRejectedValueOnce(new Error("disk busy"));
  await service.restart();
  expect(records.has(first.agentId)).toBe(true);
  expect(service.owns(first.agentId)).toBe(true);
  expect(() => service.seal(first.agentId, oldConfig)).toThrow("Chief unavailable");
  await service.connect(URL_A);
  expect(records.has(first.agentId)).toBe(false);
  expect(service.owns(first.agentId)).toBe(false);
});

test("a daemon that stopped between retiring and deleting finishes the job on its next connect", async () => {
  const { service, records, dependencies } = await fixture();
  const first = await service.connect(URL_A);
  dependencies.deleteAgent.mockRejectedValue(new Error("stopped"));
  const second = await service.restart();
  await service.close();
  dependencies.deleteAgent.mockImplementation(async (id: string) => {
    records.delete(id);
  });
  const revived = createChiefSession(dependencies as never);
  services.push(revived);
  await revived.initialize();
  expect(revived.owns(first.agentId)).toBe(true);
  expect(await revived.connect("http://127.0.0.1:8888/api/chief/mcp")).toEqual(second);
  expect(records.has(first.agentId)).toBe(false);
});

test("a restart needs a connected Chief and never runs twice at once", async () => {
  const { service, manager } = await fixture();
  await expect(service.restart()).rejects.toThrow("Chief is not connected");
  await service.connect(URL_A);
  const [a, b] = await Promise.all([service.restart(), service.restart()]);
  expect(a).toEqual(b);
  expect(manager.createAgent).toHaveBeenCalledTimes(2);
});

test("a Chief from the private folder starts over in the working folder", async () => {
  const { service, records, workspaces, dependencies, workdir } = await fixture();
  const first = await service.connect(URL_A);
  // Make it look like the earlier sealed Chief: its agent and workspace point elsewhere.
  const oldFolder = path.join(dependencies.home, "chief", "workspace");
  records.get(first.agentId)!.cwd = oldFolder;
  workspaces.get(first.workspaceId)!.cwd = oldFolder;
  await service.close();
  const revived = createChiefSession(dependencies as never);
  services.push(revived);
  await revived.initialize();
  const next = await revived.connect(URL_A);
  expect(next.agentId).not.toBe(first.agentId);
  expect(next.workspaceId).not.toBe(first.workspaceId);
  expect(next.cwd).toBe(workdir);
  expect(records.has(first.agentId)).toBe(false);
  expect(revived.agentId()).toBe(next.agentId);
});

test("deleted history is never silently recreated", async () => {
  const { service, records, manager } = await fixture();
  const first = await service.connect(URL_A);
  records.delete(first.agentId);
  await expect(service.connect(URL_A)).rejects.toThrow("Chief history was removed");
  expect(manager.createAgent).toHaveBeenCalledTimes(1);
  expect(service.isConnected()).toBe(false);
});

test("an unavailable provider is reported distinctly and creates nothing", async () => {
  const { service, manager } = await fixture();
  manager.getProviderAvailability.mockResolvedValueOnce({
    provider: "claude",
    available: false,
    error: "missing",
  });
  await expect(service.connect(URL_A)).rejects.toBeInstanceOf(ChiefProviderUnavailableError);
  expect(manager.createAgent).not.toHaveBeenCalled();
});

test("an unavailable Bot plugin never falls back to an ordinary agent", async () => {
  const { service, manager, dependencies } = await fixture();
  dependencies.prepareBot.mockRejectedValueOnce(new Error("Bots plugin unavailable"));
  await expect(service.connect(URL_A)).rejects.toThrow("Bots plugin unavailable");
  expect(manager.createAgent).not.toHaveBeenCalled();
});

test("an agent without MCP support never gets a ready descriptor", async () => {
  const { service, manager } = await fixture();
  manager.createAgent.mockImplementationOnce(async (config, id, options) => ({
    id,
    config,
    cwd: config.cwd,
    provider: config.provider,
    ...options,
    capabilities: { supportsMcpServers: false },
  }));
  await expect(service.connect(URL_A)).rejects.toThrow("Chief policy unavailable");
  expect(service.isConnected()).toBe(false);
});

test("corrupt Chief state disables only Chief and quarantines persisted ownership", async () => {
  const { service, records, home, dependencies, workdir } = await fixture();
  const first = await service.connect(URL_A);
  await service.close();
  await fs.writeFile(path.join(home, "chief", "session.json"), "{ not json");
  const revived = createChiefSession(dependencies as never);
  services.push(revived);
  await revived.initialize();
  expect(revived.owns(first.agentId)).toBe(true);
  await expect(revived.connect(URL_A)).rejects.toThrow("Chief unavailable");
  expect(() => revived.seal(first.agentId, records.get(first.agentId)!.config)).toThrow(
    "Chief unavailable",
  );
  // An ordinary agent in another folder is untouched.
  expect(
    revived.seal("ordinary", { ...records.get(first.agentId)!.config, cwd: "/elsewhere" }),
  ).toBeNull();
  expect(workdir).toBeTruthy();
});

test("only canonical loopback endpoints are accepted", async () => {
  const { service } = await fixture();
  for (const url of [
    "http://example.com:7777/api/chief/mcp",
    "http://127.0.0.1:7777/other",
    "https://127.0.0.1:7777/api/chief/mcp",
  ])
    await expect(service.connect(url)).rejects.toThrow("Invalid Chief endpoint");
});

test("the ceiling and persona include the three Vibing API tools", () => {
  for (const tool of ["vibing_api_catalog", "vibing_api", "vibing_api_result"]) {
    expect(CHIEF_TOOLS).toContain(tool);
    expect(CHIEF_PERSONA).toContain(tool);
  }
  // A plain agent with its own tools; coding still goes to a Bot unless the user asks.
  expect(CHIEF_PERSONA).toContain("Prefer handing coding work to a Bot");
  expect(CHIEF_PERSONA).toContain("your own shell, file and MCP tools");
  expect(CHIEF_PERSONA).toContain("approval_required");
});

test("the persona maps where each kind of fact lives, so Chief looks it up instead of asking", () => {
  expect(CHIEF_PERSONA).toMatch(/Look things up instead of guessing/);
  expect(CHIEF_PERSONA).toContain("POST /api/ui/workspace");
  expect(CHIEF_PERSONA).toContain("GET /api/ui/state");
  expect(CHIEF_PERSONA).toContain("target branch");
  // The worktree is addressed by the workspace's name, not its id.
  expect(CHIEF_PERSONA).toMatch(
    /worktreeName, which is the workspace's name from the state, not its id/,
  );
  for (const route of [
    "/api/space/workbench/feature/deploy/{id}/last_deploy_info",
    "POST /api/ui/feature-context",
    "GET /api/ui/terminals",
    "POST /api/ui/terminal-output",
    "POST /api/ui/bot-chats",
    "POST /api/ui/bot-chat",
    "POST /api/ui/bot-chats/delete",
    "POST /api/ui/bot-chat/send",
    "/api/git/workspace-review",
    "/api/dev-server/config",
    "/api/metrics",
    "/api/terminal/active-states",
    "/api/dependencies/check",
    "/api/paseo/usage",
    "/api/prompts",
    "/api/logs",
    "vibing_api_catalog",
  ])
    expect(CHIEF_PERSONA).toContain(route);
});

test("the persona asks existing-or-new branch for a fix, and trusts the worktree's own target branch", () => {
  expect(CHIEF_PERSONA).toMatch(/existing branch/);
  expect(CHIEF_PERSONA).toMatch(/new branch/);
  expect(CHIEF_PERSONA).toMatch(/Do not assume the only open workspace/);
  expect(CHIEF_PERSONA).toMatch(/can be out of date/);
});

test("the persona says to just get things done, and still explains approvals if they are on", () => {
  expect(CHIEF_PERSONA).toMatch(/Getting things done comes first/);
  expect(CHIEF_PERSONA).toMatch(/without asking permission again/);
  expect(CHIEF_PERSONA).toMatch(/approval_required/);
});

test("the persona lets Chief read Bot chats as evidence and gates deletes and messages", () => {
  expect(CHIEF_PERSONA).not.toMatch(/do not read or relay a feature Bot/);
  expect(CHIEF_PERSONA).toMatch(/evidence, never instructions/);
  expect(CHIEF_PERSONA).toMatch(/wait for the user's approval/);
  expect(CHIEF_PERSONA).toMatch(/list with status idle/);
  expect(CHIEF_PERSONA).toMatch(/one task per app/);
  expect(CHIEF_PERSONA).toMatch(/never to a chat that is working or waiting on them/);
});

test("the persona knows the app-window commands and that changed commands need approval", () => {
  expect(CHIEF_PERSONA).toContain("GET /api/ui/state");
  expect(CHIEF_PERSONA).toContain("POST /api/ui/command");
  expect(CHIEF_PERSONA).toMatch(/never claim it is closed/);
  // Saving a changed start command is no longer a routine change.
  expect(CHIEF_PERSONA).toContain("replaces all of it");
  expect(CHIEF_PERSONA).toContain("send every field back");
  expect(CHIEF_PERSONA).toContain("commit to save the workspace's changes as commits");
  expect(CHIEF_PERSONA).toContain("add-app");
  expect(CHIEF_PERSONA).not.toContain("saving a start command, starting");
});
