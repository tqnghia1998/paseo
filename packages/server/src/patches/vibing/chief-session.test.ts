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
  labels?: Record<string, string>;
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
    workspaceRegistry: {
      get: async (id: string) => workspaces.get(id) ?? null,
    },
    createWorkspace: vi.fn(async (cwd: string, id: string) => {
      const workspace = {
        workspaceId: id,
        cwd,
        background: true,
        archivedAt: null,
      };
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
    provider: "codex",
    cwd: workdir,
  });
  expect(manager.createAgent).toHaveBeenCalledTimes(1);
  const [config, id, options] = manager.createAgent.mock.calls[0]!;
  expect(config).toMatchObject({
    provider: "codex",
    model: "gpt-6.1-sol",
    thinkingOptionId: "high",
    cwd: workdir,
  });
  // A plain agent: full access, and not restricted to its own MCP server.
  expect(config.modeId).toBe("full-access");
  expect(config.providerOptions?.restrictToConfiguredMcp).toBeUndefined();
  expect(options).toMatchObject({
    background: true,
    workspaceId: a.workspaceId,
  });
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

test("conversation controls survive reconnect and endpoint rebind", async () => {
  const { service, records, dependencies, manager } = await fixture();
  const first = await service.connect(URL_A);
  const agent = records.get(first.agentId)!;
  agent.config = {
    ...agent.config,
    model: "opus",
    modeId: "default",
    thinkingOptionId: "high",
    providerOptions: { fastMode: true },
  };
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
  expect(reloaded.thinkingOptionId).toBe("high");
  expect(reloaded.providerOptions).toEqual({ fastMode: true });
  expect(reloaded.mcpServers?.chief).toMatchObject({
    url: "http://127.0.0.1:8888/api/chief/mcp",
  });
});

test("conversation selections survive sealing and reconnect without restarting the agent", async () => {
  const { service, records, manager } = await fixture();
  const first = await service.connect(URL_A);
  const agent = records.get(first.agentId)!;
  const selected = {
    model: "opus",
    modeId: "default",
    thinkingOptionId: "high",
    providerOptions: { fastMode: true },
  };
  agent.config = { ...agent.config, ...selected };
  expect(service.seal(first.agentId, agent.config)).toMatchObject(selected);
  await service.connect(URL_A);
  expect(agent.config).toMatchObject(selected);
  expect(manager.reloadAgentSession).not.toHaveBeenCalled();
});

test("user MCP changes cannot replace Chief's source-owned tools", async () => {
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
  expect(sealed.mcpServers?.seatalk).toBeUndefined();
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
  expect(second).toMatchObject({
    workspaceId: first.workspaceId,
    cwd: first.cwd,
    status: "ready",
  });
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

test("a full retirement backlog rejects reset without forgetting old Chiefs and recovers after cleanup", async () => {
  const { service, records, dependencies, manager, home } = await fixture();
  const first = await service.connect(URL_A);
  dependencies.deleteAgent.mockRejectedValue(new Error("cleanup unavailable"));
  for (let count = 0; count < 20; count++) await service.restart();
  const currentId = service.agentId();
  const created = manager.createAgent.mock.calls.length;
  const before = await fs.readFile(path.join(home, "chief", "session.json"), "utf8");
  await expect(service.restart()).rejects.toThrow(/cleanup|retir/i);
  expect(service.agentId()).toBe(currentId);
  expect(service.isConnected()).toBe(true);
  expect(manager.createAgent).toHaveBeenCalledTimes(created);
  expect(await fs.readFile(path.join(home, "chief", "session.json"), "utf8")).toBe(before);
  expect(service.owns(first.agentId)).toBe(true);
  expect(() => service.seal(first.agentId, records.get(first.agentId)!.config)).toThrow(
    "Chief unavailable",
  );

  await service.close();
  const revived = createChiefSession(dependencies as never);
  services.push(revived);
  await revived.initialize();
  expect(revived.owns(first.agentId)).toBe(true);
  expect(() => revived.seal(first.agentId, records.get(first.agentId)!.config)).toThrow(
    "Chief unavailable",
  );
  await revived.connect(URL_A);
  await expect(revived.restart()).rejects.toThrow(/cleanup|retir/i);
  expect(revived.agentId()).toBe(currentId);
  dependencies.deleteAgent.mockImplementation(async (id: string) => {
    records.delete(id);
  });
  const next = await revived.restart();
  expect(next.agentId).not.toBe(currentId);
  expect(records.has(first.agentId)).toBe(false);
  expect(records.has(currentId!)).toBe(false);
  expect(
    JSON.parse(await fs.readFile(path.join(home, "chief", "session.json"), "utf8")).retired,
  ).toEqual([]);
});

test.each([URL_A, "http://127.0.0.1:8888/api/chief/mcp"])(
  "a reconnect to %s during reset cleanup never finalizes an uncreated identity",
  async (url) => {
    const { service, records, dependencies, manager, home } = await fixture();
    const first = await service.connect(URL_A);
    dependencies.deleteAgent.mockRejectedValue(new Error("cleanup unavailable"));
    for (let count = 0; count < 20; count++) await service.restart();
    const oldId = service.agentId()!;
    const created = manager.createAgent.mock.calls.length;
    const cleanupEntered = Promise.withResolvers<void>();
    const cleanupRelease = Promise.withResolvers<void>();
    const oldFlushEntered = Promise.withResolvers<void>();
    const oldFlushRelease = Promise.withResolvers<void>();
    dependencies.deleteAgent.mockImplementation(async (id: string) => {
      if (id !== first.agentId) throw new Error("cleanup still unavailable");
      cleanupEntered.resolve();
      await cleanupRelease.promise;
      records.delete(id);
    });
    manager.flush.mockImplementation(async () => {
      if (service.agentId() !== oldId) return;
      oldFlushEntered.resolve();
      await oldFlushRelease.promise;
    });
    const resetting = service.restart();
    await cleanupEntered.promise;
    const reconnecting = service.connect(url);
    // Give an incorrectly admitted reconnect time to reach its flush. A serialized
    // reconnect stays pending behind reset and cannot enter this gate.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      oldFlushEntered.promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 100);
      }),
    ]);
    clearTimeout(timer);
    cleanupRelease.resolve();
    try {
      await vi.waitFor(async () => {
        const stored = JSON.parse(
          await fs.readFile(path.join(home, "chief", "session.json"), "utf8"),
        );
        expect(stored.agentId).not.toBe(oldId);
      });
    } finally {
      oldFlushRelease.resolve();
    }
    const [reset, reconnected] = await Promise.all([resetting, reconnecting]);
    const stored = JSON.parse(await fs.readFile(path.join(home, "chief", "session.json"), "utf8"));
    expect(reconnected).toEqual(reset);
    expect(reset.agentId).not.toBe(oldId);
    expect(stored).toMatchObject({ agentId: reset.agentId, state: "created" });
    expect(records.has(reset.agentId)).toBe(true);
    expect(manager.createAgent).toHaveBeenCalledTimes(created + 1);
    expect(service.endpoint()).toBe(url);
    expect(stored.mcpUrl).toBe(url);
    expect(await service.connect(url)).toEqual(reset);
    dependencies.deleteAgent.mockImplementation(async (id: string) => {
      records.delete(id);
    });
    const next = await service.restart();
    expect(records.has(next.agentId)).toBe(true);
  },
);

test("a reconnect waiting on failed reset cleanup preserves the existing identity", async () => {
  const { service, dependencies, records, home } = await fixture();
  await service.connect(URL_A);
  dependencies.deleteAgent.mockRejectedValue(new Error("cleanup unavailable"));
  for (let count = 0; count < 20; count++) await service.restart();
  const oldId = service.agentId()!;
  const before = await fs.readFile(path.join(home, "chief", "session.json"), "utf8");
  const cleanupEntered = Promise.withResolvers<void>();
  const cleanupRelease = Promise.withResolvers<void>();
  dependencies.deleteAgent.mockImplementation(async () => {
    cleanupEntered.resolve();
    await cleanupRelease.promise;
    throw new Error("cleanup still unavailable");
  });
  const resetting = service.restart();
  await cleanupEntered.promise;
  const reconnecting = service.connect(URL_A);
  const outcomes = Promise.allSettled([resetting, reconnecting]);
  cleanupRelease.resolve();
  for (const outcome of await outcomes) {
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.reason.message).toMatch(/cleanup.*blocked/);
  }
  expect(service.agentId()).toBe(oldId);
  expect(service.isConnected()).toBe(true);
  expect(records.has(oldId)).toBe(true);
  expect(await fs.readFile(path.join(home, "chief", "session.json"), "utf8")).toBe(before);
  expect((await service.connect(URL_A)).agentId).toBe(oldId);
});

test("folder migration refuses retirement overflow and succeeds when one old record can be cleaned", async () => {
  const { service, records, workspaces, dependencies, manager, home, workdir } = await fixture();
  const first = await service.connect(URL_A);
  dependencies.deleteAgent.mockRejectedValue(new Error("cleanup unavailable"));
  for (let count = 0; count < 20; count++) await service.restart();
  const currentId = service.agentId()!;
  const current = records.get(currentId)!;
  current.cwd = path.join(home, "old-Chief-folder");
  workspaces.get(current.workspaceId!)!.cwd = current.cwd;
  const before = await fs.readFile(path.join(home, "chief", "session.json"), "utf8");
  const created = manager.createAgent.mock.calls.length;
  await service.close();
  const revived = createChiefSession(dependencies as never);
  services.push(revived);
  await revived.initialize();
  await expect(revived.connect(URL_A)).rejects.toThrow(/cleanup|retir/i);
  expect(revived.agentId()).toBe(currentId);
  expect(revived.owns(first.agentId)).toBe(true);
  expect(manager.createAgent).toHaveBeenCalledTimes(created);
  expect(await fs.readFile(path.join(home, "chief", "session.json"), "utf8")).toBe(before);
  dependencies.deleteAgent.mockImplementation(async (id: string) => {
    if (id !== first.agentId) throw new Error("still unavailable");
    records.delete(id);
  });
  const migrated = await revived.connect(URL_A);
  expect(migrated.agentId).not.toBe(currentId);
  expect(migrated.cwd).toBe(workdir);
  expect(records.has(first.agentId)).toBe(false);
  const stored = JSON.parse(await fs.readFile(path.join(home, "chief", "session.json"), "utf8"));
  expect(stored.retired).toHaveLength(20);
  expect(stored.retired).toContain(currentId);
  for (const id of stored.retired) {
    expect(revived.owns(id)).toBe(true);
    expect(() => revived.seal(id, records.get(id)!.config)).toThrow("Chief unavailable");
  }
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

test("a Chief saved on another provider starts over on the source-owned one", async () => {
  const { service, records, dependencies } = await fixture();
  const first = await service.connect(URL_A);
  // Make it look like the earlier Claude Chief.
  records.get(first.agentId)!.provider = "claude";
  await service.close();
  const revived = createChiefSession(dependencies as never);
  services.push(revived);
  await revived.initialize();
  const next = await revived.connect(URL_A);
  expect(next.agentId).not.toBe(first.agentId);
  expect(next.provider).toBe("codex");
  expect(records.has(first.agentId)).toBe(false);
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
    provider: "codex",
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
    revived.seal("ordinary", {
      ...records.get(first.agentId)!.config,
      cwd: "/elsewhere",
    }),
  ).toBeNull();
  expect(workdir).toBeTruthy();
});

test.each(["missing", "corrupt"] as const)(
  "%s Chief state never claims ordinary chats in the shared working folder",
  async (mode) => {
    const { service, records, home, workdir, dependencies } = await fixture();
    await service.close();
    const config: AgentSessionConfig = { provider: "claude", cwd: workdir };
    const ordinary = {
      id: "ordinary-same-folder",
      labels: { "paseo-bots.bot": "reviewer" },
      config,
      cwd: workdir,
      provider: "claude",
      background: false,
      capabilities: { supportsMcpServers: true },
    };
    records.set(ordinary.id, ordinary);
    if (mode === "corrupt") {
      await fs.mkdir(path.join(home, "chief"), { mode: 0o700 });
      await fs.writeFile(path.join(home, "chief", "session.json"), "{ not json", { mode: 0o600 });
    }
    const revived = createChiefSession(dependencies as never);
    services.push(revived);
    await revived.initialize();
    expect(revived.owns(ordinary.id)).toBe(false);
    expect(revived.seal(ordinary.id, config)).toBeNull();
    expect(revived.seal("new-ordinary-same-folder", config)).toBeNull();
    if (mode === "missing") {
      const chief = await revived.connect(URL_A);
      expect(chief.agentId).not.toBe(ordinary.id);
      expect(revived.owns(chief.agentId)).toBe(true);
      expect(revived.seal(ordinary.id, config)).toBeNull();
    } else {
      await expect(revived.connect(URL_A)).rejects.toThrow("Chief unavailable");
    }
    expect(records.get(ordinary.id)).toBe(ordinary);
    expect(dependencies.deleteAgent).not.toHaveBeenCalled();
  },
);

test.each(["missing", "corrupt"] as const)(
  "%s Chief state quarantines marked Chief records even outside the shared folder",
  async (mode) => {
    const { service, records, home, workdir, dependencies } = await fixture();
    const chief = await service.connect(URL_A);
    await service.close();
    const saved = records.get(chief.agentId)!;
    saved.labels =
      mode === "missing"
        ? { "paseo-chief.policy": "chief-v1" }
        : { "paseo-bots.bot": "vibing-chief" };
    saved.cwd = path.join(home, "old-private-Chief-folder");
    saved.config = { ...saved.config, cwd: saved.cwd };
    if (mode === "missing") await fs.unlink(path.join(home, "chief", "session.json"));
    else await fs.writeFile(path.join(home, "chief", "session.json"), "{ not json");
    const revived = createChiefSession(dependencies as never);
    services.push(revived);
    await revived.initialize();
    expect(revived.owns(chief.agentId)).toBe(true);
    expect(() => revived.seal(chief.agentId, saved.config)).toThrow("Chief unavailable");
    expect(revived.seal("ordinary-same-folder", { provider: "claude", cwd: workdir })).toBeNull();
    await expect(revived.connect(URL_A)).rejects.toThrow("Chief unavailable");
    expect(dependencies.deleteAgent).not.toHaveBeenCalled();
  },
);

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
  expect(CHIEF_PERSONA).toContain("only an approval_required response means a card is waiting");
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
