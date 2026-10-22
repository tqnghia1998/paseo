import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager, type ManagedAgent } from "../../server/agent/agent-manager.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "../../server/agent/agent-sdk-types.js";
import {
  idleAgentCloseMsFromEnv,
  startIdleAgentReaper,
  type IdleAgentReaperManager,
} from "./idle-agent-reaper.js";

const logger = createTestLogger();

const CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: true,
  supportsSessionListing: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

class FakeSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly id = randomUUID();
  closed = false;
  private subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(private readonly config: AgentSessionConfig) {}

  async run() {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(): Promise<{ turnId: string }> {
    // Never completes, so the run stays active.
    return { turnId: "turn-1" };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  push(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) callback(event);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: null,
    };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode() {
    return null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence() {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly sessions: FakeSession[] = [];

  async isAvailable() {
    return true;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const session = new FakeSession(config);
    this.sessions.push(session);
    return session;
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    config?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    return this.createSession({ provider: "codex", cwd: config?.cwd ?? process.cwd() });
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }
}

const workdirs: string[] = [];

async function createIdleAgent() {
  const workdir = mkdtempSync(join(tmpdir(), "idle-agent-reaper-"));
  workdirs.push(workdir);
  const client = new FakeClient();
  const manager = new AgentManager({ clients: { codex: client }, logger });
  const agent = await manager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
    workspaceId: undefined,
  });
  return { manager, agentId: agent.id, session: client.sessions[0]! };
}

afterEach(() => {
  vi.useRealTimers();
  for (const workdir of workdirs.splice(0)) rmSync(workdir, { recursive: true, force: true });
});

describe("AgentManager.closeIdleAgent", () => {
  test("closes an idle agent's provider session", async () => {
    const { manager, agentId, session } = await createIdleAgent();

    await expect(manager.closeIdleAgent(agentId)).resolves.toBe(true);

    expect(session.closed).toBe(true);
    expect(manager.getAgent(agentId)).toBeNull();
  });

  test("keeps an agent whose background shell or subagent is still running", async () => {
    const { manager, agentId, session } = await createIdleAgent();
    session.push({
      type: "provider_subagent",
      provider: "codex",
      event: { type: "upsert", id: "shell-1", title: "npm test", status: "running" },
    });
    await manager.flush();

    await expect(manager.closeIdleAgent(agentId)).resolves.toBe(false);

    expect(session.closed).toBe(false);
    expect(manager.getAgent(agentId)?.lifecycle).toBe("idle");
    await manager.closeAgent(agentId);
  });

  test("keeps an agent with an active run", async () => {
    const { manager, agentId, session } = await createIdleAgent();
    const run = manager.streamAgent(agentId, "work");
    void (async () => {
      for await (const _event of run) {
      }
    })().catch(() => undefined);
    await manager.waitForAgentRunStart(agentId);

    await expect(manager.closeIdleAgent(agentId)).resolves.toBe(false);

    expect(session.closed).toBe(false);
    await manager.closeAgent(agentId);
  });

  test("keeps an agent when a run starts after the close was requested", async () => {
    const { manager, agentId, session } = await createIdleAgent();

    const closing = manager.closeIdleAgent(agentId);
    const run = manager.streamAgent(agentId, "arrived just in time");
    void (async () => {
      for await (const _event of run) {
      }
    })().catch(() => undefined);

    await expect(closing).resolves.toBe(false);
    expect(session.closed).toBe(false);
    await manager.closeAgent(agentId);
  });
});

function fakeAgent(overrides: Partial<ManagedAgent> & { id: string }): ManagedAgent {
  return {
    lifecycle: "idle",
    internal: false,
    updatedAt: new Date(0),
    persistence: { provider: "claude", sessionId: `session-${overrides.id}` },
    activeForegroundTurnId: null,
    pendingPermissions: new Map(),
    ...overrides,
  } as unknown as ManagedAgent;
}

function fakeManager(agents: ManagedAgent[]) {
  const closed: string[] = [];
  const manager: IdleAgentReaperManager = {
    listAgents: () => agents.filter((agent) => !closed.includes(agent.id)),
    closeIdleAgent: async (agentId) => {
      closed.push(agentId);
      return true;
    },
  };
  return { manager, closed };
}

describe("startIdleAgentReaper", () => {
  test("closes an agent once it has been idle for the timeout", async () => {
    vi.useFakeTimers({ now: 0 });
    const { manager, closed } = fakeManager([fakeAgent({ id: "a", updatedAt: new Date(0) })]);
    const stop = startIdleAgentReaper({ agentManager: manager, logger, idleMs: 10 * 60_000 });

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(closed).toEqual(["a"]);
    stop();
  });

  test("measures idle time from the latest activity", async () => {
    vi.useFakeTimers({ now: 0 });
    const agent = fakeAgent({ id: "a", updatedAt: new Date(0) });
    const { manager, closed } = fakeManager([agent]);
    const stop = startIdleAgentReaper({ agentManager: manager, logger, idleMs: 10 * 60_000 });

    await vi.advanceTimersByTimeAsync(8 * 60_000);
    agent.updatedAt = new Date(8 * 60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(closed).toEqual(["a"]);
    stop();
  });

  test("gives an agent loaded with old activity a full idle period", async () => {
    vi.useFakeTimers({ now: 60 * 60_000 });
    const agents: ManagedAgent[] = [];
    const { manager, closed } = fakeManager(agents);
    const stop = startIdleAgentReaper({ agentManager: manager, logger, idleMs: 10 * 60_000 });

    await vi.advanceTimersByTimeAsync(60_000);
    agents.push(fakeAgent({ id: "reopened", updatedAt: new Date(0) }));
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(closed).toEqual(["reopened"]);
    stop();
  });

  test("leaves internal, busy and unresumable agents alone", async () => {
    vi.useFakeTimers({ now: 0 });
    const { manager, closed } = fakeManager([
      fakeAgent({ id: "internal", internal: true }),
      fakeAgent({ id: "running", lifecycle: "running" }),
      fakeAgent({ id: "failed", lifecycle: "error" }),
      fakeAgent({ id: "turn", activeForegroundTurnId: "turn-1" }),
      fakeAgent({
        id: "permission",
        pendingPermissions: new Map([["p", {}]]) as ManagedAgent["pendingPermissions"],
      }),
      fakeAgent({ id: "unresumable", persistence: null }),
      fakeAgent({ id: "idle" }),
    ]);
    const stop = startIdleAgentReaper({ agentManager: manager, logger, idleMs: 60_000 });

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(closed).toEqual(["idle"]);
    stop();
  });

  test("stops sweeping once stopped", async () => {
    vi.useFakeTimers({ now: 0 });
    const { manager, closed } = fakeManager([fakeAgent({ id: "a" })]);
    const stop = startIdleAgentReaper({ agentManager: manager, logger, idleMs: 60_000 });
    stop();

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(closed).toEqual([]);
  });
});

describe("idleAgentCloseMsFromEnv", () => {
  test("defaults to ten minutes", () => {
    expect(idleAgentCloseMsFromEnv({})).toBe(10 * 60_000);
  });

  test("reads minutes and turns off at zero", () => {
    expect(idleAgentCloseMsFromEnv({ PASEO_IDLE_AGENT_CLOSE_MINUTES: "30" })).toBe(30 * 60_000);
    expect(idleAgentCloseMsFromEnv({ PASEO_IDLE_AGENT_CLOSE_MINUTES: "0" })).toBeNull();
  });

  test("falls back to the default for an invalid value", () => {
    expect(idleAgentCloseMsFromEnv({ PASEO_IDLE_AGENT_CLOSE_MINUTES: "soon" })).toBe(10 * 60_000);
    expect(idleAgentCloseMsFromEnv({ PASEO_IDLE_AGENT_CLOSE_MINUTES: "-5" })).toBe(10 * 60_000);
  });
});
