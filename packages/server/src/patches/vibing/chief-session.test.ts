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
  const dependencies = {
    home,
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
  return { home, records, manager, dependencies, service };
}

test("concurrent first connections create one durable background normal agent", async () => {
  const { service, manager, home } = await fixture();
  expect(service.isConnected()).toBe(false);
  const [a, b] = await Promise.all([
    service.connect("http://127.0.0.1:7777/api/chief/mcp"),
    service.connect("http://127.0.0.1:7777/api/chief/mcp"),
  ]);
  expect(a).toEqual(b);
  expect(service.isConnected()).toBe(true);
  expect(a).toMatchObject({
    protocol: 1,
    status: "ready",
    policy: "chief-v1",
    provider: "claude",
    cwd: path.join(home, "chief", "workspace"),
  });
  expect(manager.createAgent).toHaveBeenCalledTimes(1);
  const [config, id, options] = manager.createAgent.mock.calls[0]!;
  expect(config).toMatchObject({
    provider: "claude",
    model: "sonnet",
    providerOptions: { restrictToConfiguredMcp: true },
  });
  expect(options).toMatchObject({ background: true, workspaceId: a.workspaceId });
  expect(config.internal).not.toBe(true);
  expect(options.labels?.["paseo-bots.bot"]).toBe("vibing-chief");
  expect(config.systemPrompt).toContain("Managed Chief memory and instructions");
  expect(service.owns(id)).toBe(true);
  expect(service.owns("ordinary-agent")).toBe(false);
  expect(JSON.stringify(config)).not.toContain("cleanup");
});

test("restart discovers ownership before recovery and loads the same agent", async () => {
  const { service, dependencies, manager } = await fixture();
  const first = await service.connect("http://127.0.0.1:7777/api/chief/mcp");
  await service.close();
  const restarted = createChiefSession(dependencies);
  services.push(restarted);
  await restarted.initialize();
  expect(restarted.owns(first.agentId)).toBe(true);
  expect(() => restarted.seal(first.agentId, manager.createAgent.mock.calls[0]![0])).toThrow(
    "Chief session is not initialized",
  );
  expect(await restarted.connect("http://127.0.0.1:8888/api/chief/mcp")).toEqual(first);
  expect(manager.createAgent).toHaveBeenCalledTimes(1);
  expect(dependencies.loadAgent).toHaveBeenCalledWith(first.agentId);
});

const URL_A = "http://127.0.0.1:7777/api/chief/mcp";

test("a restart starts a fresh agent under the same workspace and deletes the old one", async () => {
  const { service, records, manager, dependencies } = await fixture();
  const first = await service.connect(URL_A);
  const second = await service.restart();
  expect(second.agentId).not.toBe(first.agentId);
  expect(second).toMatchObject({ workspaceId: first.workspaceId, cwd: first.cwd, status: "ready" });
  expect(manager.createAgent).toHaveBeenCalledTimes(2);
  const [config, id, options] = manager.createAgent.mock.calls[1]!;
  expect(id).toBe(second.agentId);
  expect(options).toMatchObject({ background: true, workspaceId: first.workspaceId });
  expect(config.toolPolicy).toEqual(manager.createAgent.mock.calls[0]![0].toolPolicy);
  expect(dependencies.deleteAgent).toHaveBeenCalledWith(first.agentId);
  expect(records.has(first.agentId)).toBe(false);
  expect(records.has(second.agentId)).toBe(true);
  expect(service.agentId()).toBe(second.agentId);
  expect(service.isConnected()).toBe(true);
  expect(service.owns(second.agentId)).toBe(true);
});

test("an agent a restart replaced can never be sealed or resumed, even when its deletion fails", async () => {
  const { service, records, dependencies, manager } = await fixture();
  const first = await service.connect(URL_A);
  const oldConfig = manager.createAgent.mock.calls[0]![0];
  dependencies.deleteAgent.mockRejectedValueOnce(new Error("disk busy"));
  await service.restart();
  // Still on disk, but retired: owned (so nothing auto-resumes it) and never sealed.
  expect(records.has(first.agentId)).toBe(true);
  expect(service.owns(first.agentId)).toBe(true);
  expect(() => service.seal(first.agentId, oldConfig)).toThrow("Chief unavailable");
  // The next connect retries the deletion.
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
  const revived = createChiefSession(dependencies);
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

test("deleted history is never silently recreated", async () => {
  const { service, records, manager } = await fixture();
  const first = await service.connect("http://127.0.0.1:7777/api/chief/mcp");
  records.delete(first.agentId);
  await expect(service.connect("http://127.0.0.1:7777/api/chief/mcp")).rejects.toThrow(
    "Chief history was removed",
  );
  expect(manager.createAgent).toHaveBeenCalledTimes(1);
  expect(service.isConnected()).toBe(false);
});

test("existing three-tool Chief migrates in place to managed Bot services", async () => {
  const { service, dependencies, manager, records } = await fixture();
  const first = await service.connect("http://127.0.0.1:7777/api/chief/mcp");
  const old = records.get(first.agentId)!;
  old.config = {
    ...old.config,
    systemPrompt: "Legacy Chief",
    toolPolicy: {
      preapproved: ["list_apps", "list_workspaces", "open_workspace"].map((tool) => ({
        kind: "mcp",
        server: "chief",
        tool,
      })),
    },
  };
  await service.close();
  const restarted = createChiefSession(
    dependencies as unknown as Parameters<typeof createChiefSession>[0],
  );
  services.push(restarted);
  await restarted.initialize();
  expect(await restarted.connect("http://127.0.0.1:8888/api/chief/mcp")).toEqual(first);
  expect(manager.createAgent).toHaveBeenCalledTimes(1);
  expect(manager.reloadAgentSession.mock.calls.at(-1)?.[1].systemPrompt).toContain(
    "Managed Chief memory",
  );
  expect(manager.updateAgentMetadata).toHaveBeenCalledWith(first.agentId, {
    labels: { "paseo-bots.bot": "vibing-chief", "paseo-chief.policy": "chief-v1" },
  });
});

test("a Chief saved with the retired review tools rebinds to the handoff tools", async () => {
  const { service, dependencies, manager, records } = await fixture();
  const first = await service.connect("http://127.0.0.1:7777/api/chief/mcp");
  const old = records.get(first.agentId)!;
  const retired = [
    "list_apps",
    "list_workspaces",
    "open_workspace",
    "list_bots",
    "check_chat",
    "search_chats",
    "get_setup",
    "read_memory",
    "write_memory",
    "read_skill",
    "ask_feature_bot",
    "check_feature_bot",
  ];
  old.config = {
    ...old.config,
    systemPrompt: "Reviewing Chief",
    toolPolicy: {
      preapproved: retired.map((tool) => ({ kind: "mcp", server: "chief", tool })),
    },
  };
  await service.close();
  const restarted = createChiefSession(
    dependencies as unknown as Parameters<typeof createChiefSession>[0],
  );
  services.push(restarted);
  await restarted.initialize();
  expect(await restarted.connect("http://127.0.0.1:8888/api/chief/mcp")).toEqual(first);
  const rebound = manager.reloadAgentSession.mock.calls.at(-1)![1];
  const tools = rebound.toolPolicy!.preapproved.map((grant: { tool: string }) => grant.tool);
  expect(tools).toEqual(
    expect.arrayContaining(["resolve_merge_request", "open_feature", "start_feature_task"]),
  );
  expect(tools).not.toContain("ask_feature_bot");
  expect(tools).not.toContain("check_chat");
  expect(rebound.systemPrompt).toContain("you never review, write or change code yourself");
  expect(restarted.handoffKey()).toHaveLength(32);
});

test("the ceiling and persona include the three Vibing API tools", () => {
  for (const tool of ["vibing_api_catalog", "vibing_api", "vibing_api_result"]) {
    expect(CHIEF_TOOLS).toContain(tool);
    expect(CHIEF_PERSONA).toContain(tool);
  }
  expect(CHIEF_PERSONA).toContain("you never review, write or change code yourself");
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

test("a Chief saved with the handoff-only ceiling rebinds to include the Vibing API tools", async () => {
  const { service, dependencies, manager, records } = await fixture();
  const first = await service.connect("http://127.0.0.1:7777/api/chief/mcp");
  const old = records.get(first.agentId)!;
  const handoffOnly = CHIEF_TOOLS.filter((tool) => !tool.startsWith("vibing_api"));
  old.config = {
    ...old.config,
    systemPrompt: "Handoff Chief",
    toolPolicy: {
      preapproved: handoffOnly.map((tool) => ({ kind: "mcp", server: "chief", tool })),
    },
  };
  await service.close();
  const restarted = createChiefSession(
    dependencies as unknown as Parameters<typeof createChiefSession>[0],
  );
  services.push(restarted);
  await restarted.initialize();
  expect(await restarted.connect("http://127.0.0.1:8888/api/chief/mcp")).toEqual(first);
  const rebound = manager.reloadAgentSession.mock.calls.at(-1)![1];
  const tools = rebound.toolPolicy!.preapproved.map((grant: { tool: string }) => grant.tool);
  expect(tools).toEqual([...CHIEF_TOOLS]);
  expect(rebound.systemPrompt).toContain("vibing_api_result");
});

test("an unavailable Claude provider is reported distinctly and creates nothing", async () => {
  const { service, manager } = await fixture();
  manager.getProviderAvailability.mockResolvedValueOnce({
    provider: "claude",
    available: false,
    error: null,
  });
  await expect(service.connect("http://127.0.0.1:7777/api/chief/mcp")).rejects.toBeInstanceOf(
    ChiefProviderUnavailableError,
  );
  expect(manager.getProviderAvailability).toHaveBeenCalledWith("claude");
  expect(manager.createAgent).not.toHaveBeenCalled();
  expect(service.isConnected()).toBe(false);
  // Once Claude can run, the same session connects normally.
  await expect(service.connect("http://127.0.0.1:7777/api/chief/mcp")).resolves.toMatchObject({
    status: "ready",
  });
});

test("an unavailable Bot plugin never falls back to an ordinary agent", async () => {
  const { service, dependencies, manager } = await fixture();
  dependencies.prepareBot.mockRejectedValueOnce(new Error("Plugin unavailable"));
  await expect(service.connect("http://127.0.0.1:7777/api/chief/mcp")).rejects.toThrow(
    "Plugin unavailable",
  );
  expect(manager.createAgent).not.toHaveBeenCalled();
  expect(service.isConnected()).toBe(false);
});

test("the host seal rejects replacement authority and ordinary agents are unchanged", async () => {
  const { service, manager } = await fixture();
  const first = await service.connect("http://127.0.0.1:7777/api/chief/mcp");
  const config = manager.createAgent.mock.calls[0]![0];
  expect(service.seal("ordinary-agent", config)).toBeNull();
  expect(() => service.seal(first.agentId, { ...config, provider: "codex" })).toThrow(
    "Chief authority changed",
  );
  expect(() => service.seal(first.agentId, { ...config, mcpServers: {} })).toThrow(
    "Chief authority changed",
  );
  const sealed = service.seal(first.agentId, { ...config, providerOptions: {} });
  expect(sealed?.providerOptions?.restrictToConfiguredMcp).toBe(true);
});

test("an unsupported manager agent never gets a ready descriptor", async () => {
  const { service, manager } = await fixture();
  manager.createAgent.mockImplementationOnce(
    async (config: AgentSessionConfig, id: string, options: CreateAgentOptions) => ({
      id,
      config,
      ...options,
      provider: "claude",
      cwd: config.cwd,
      capabilities: { supportsMcpServers: false },
    }),
  );
  await expect(service.connect("http://127.0.0.1:7777/api/chief/mcp")).rejects.toThrow(
    "Chief policy unavailable",
  );
});

test("corrupt Chief state disables only Chief and quarantines persisted ownership", async () => {
  const { service, dependencies, manager, home } = await fixture();
  const first = await service.connect("http://127.0.0.1:7777/api/chief/mcp");
  await service.close();
  await fs.writeFile(path.join(home, "chief", "session.json"), "invalid json");
  const restarted = createChiefSession(dependencies);
  services.push(restarted);
  await expect(restarted.initialize()).resolves.toBeUndefined();
  expect(restarted.owns(first.agentId)).toBe(true);
  expect(restarted.isConnected()).toBe(false);
  expect(restarted.agentToken()).toBeNull();
  expect(() => restarted.seal(first.agentId, manager.createAgent.mock.calls[0]![0])).toThrow(
    "Chief unavailable",
  );
  expect(restarted.seal("ordinary", { provider: "claude", cwd: "/ordinary" })).toBeNull();
  await expect(restarted.connect("http://127.0.0.1:8888/api/chief/mcp")).rejects.toThrow(
    "Chief unavailable",
  );
  expect(manager.createAgent).toHaveBeenCalledTimes(1);
});

test("crash-intermediate loopback ports are canonicalized but remote servers and changed tokens fail", async () => {
  const { service, dependencies, manager, records } = await fixture();
  const first = await service.connect("http://127.0.0.1:7777/api/chief/mcp");
  const original = manager.createAgent.mock.calls[0]![0];
  const intermediate = structuredClone(original);
  intermediate.mcpServers.chief.url = "http://127.0.0.1:8888/api/chief/mcp";
  expect(service.seal(first.agentId, intermediate)?.mcpServers).toEqual(original.mcpServers);
  for (const url of [
    "https://example.test/api/chief/mcp",
    "http://127.0.0.1:8888/api/chief/mcp?token=x",
  ]) {
    const changed = structuredClone(original);
    changed.mcpServers.chief.url = url;
    expect(() => service.seal(first.agentId, changed)).toThrow("Chief authority changed");
  }
  const changedToken = structuredClone(original);
  changedToken.mcpServers.chief.headers.Authorization = "Bearer changed";
  expect(() => service.seal(first.agentId, changedToken)).toThrow("Chief authority changed");
  records.get(first.agentId).config = intermediate;
  await service.close();
  const restarted = createChiefSession(dependencies);
  services.push(restarted);
  await restarted.initialize();
  expect((await restarted.connect("http://127.0.0.1:9999/api/chief/mcp")).agentId).toBe(
    first.agentId,
  );
  expect(manager.reloadAgentSession.mock.calls.at(-1)?.[1].mcpServers.chief.url).toBe(
    "http://127.0.0.1:9999/api/chief/mcp",
  );
});
