import {
  formatSystemNotificationPrompt,
  isSystemInjectedEnvelope,
  parseAgentMessage,
  formatAgentMessage,
  prepareAgentMessage,
  projectAgentMessages,
} from "./agent-messages/index.js";
import { expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { sendPromptToAgent, waitForAgentRunStartWithTimeout } from "./agent-prompt.js";
import { AgentStorage } from "./agent-storage.js";
import type {
  AgentClient,
  AgentRunResult,
  AgentSession,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

test("isSystemInjectedEnvelope matches the envelope formatSystemNotificationPrompt produces", () => {
  expect(isSystemInjectedEnvelope(formatSystemNotificationPrompt("child finished"))).toBe(true);
  expect(isSystemInjectedEnvelope("hello world")).toBe(false);
});

// Independent of the production constant so shortening the budget breaks this test.
const EXPECTED_RUN_START_BUDGET_MS = 60_000;
// The slowest provider startup budget the run-start wait has to sit outside of today
// (OpenCode's OPENCODE_SERVER_STARTUP_TIMEOUT_MS).
const SLOWEST_PROVIDER_STARTUP_BUDGET_MS = 30_000;

const RUN_START_TEST_CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsSessionListing: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

/**
 * Provider session whose turn start is held open for a configurable span, so the real
 * AgentManager run-state transition (pendingRun.started -> lifecycle "running" ->
 * agent_state) is what the run-start wait observes. `startDelayMs: null` never starts.
 */
class SlowStartAgentSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = RUN_START_TEST_CAPABILITIES;
  readonly id = randomUUID();
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private releaseStartTurn!: () => void;
  private readonly released = new Promise<void>((resolve) => {
    this.releaseStartTurn = resolve;
  });

  constructor(private readonly startDelayMs: number | null) {}

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  /** Teardown hook so a never-starting turn cannot wedge the suite. */
  release(): void {
    this.releaseStartTurn();
  }

  async startTurn(): Promise<{ turnId: string }> {
    await new Promise<void>((resolve) => {
      if (this.startDelayMs !== null) {
        setTimeout(resolve, this.startDelayMs);
      }
      void this.released.then(resolve);
    });
    const turnId = "turn-1";
    setTimeout(() => {
      this.pushEvent({ type: "turn_started", provider: this.provider, turnId });
      this.pushEvent({ type: "turn_completed", provider: this.provider, turnId });
    }, 0);
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  pushEvent(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) {
      callback(event);
    }
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return { provider: this.provider, sessionId: this.id, model: null, modeId: null };
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

  async close(): Promise<void> {}
}

class SlowStartAgentClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = RUN_START_TEST_CAPABILITIES;
  readonly sessions: SlowStartAgentSession[] = [];

  constructor(private readonly startDelayMs: number | null) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(): Promise<AgentSession> {
    const session = new SlowStartAgentSession(this.startDelayMs);
    this.sessions.push(session);
    return session;
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }

  async resumeSession(): Promise<AgentSession> {
    return await this.createSession();
  }
}

/**
 * Real AgentManager driving a real agent, so the run-start wait exercises the production
 * run-state and agent_state subscription path rather than a replaced method.
 */
async function createRunStartScenario(startDelayMs: number | null): Promise<{
  agentManager: AgentManager;
  agentId: string;
  storage: AgentStorage;
  sessions: SlowStartAgentSession[];
  startRun: () => Promise<void>;
  cleanup: () => Promise<void>;
}> {
  const workdir = mkdtempSync(join(tmpdir(), "agent-run-start-budget-"));
  const client = new SlowStartAgentClient(startDelayMs);
  const storage = new AgentStorage(join(workdir, "agents"), createTestLogger());
  const agentManager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger: createTestLogger(),
  });
  const snapshot = await agentManager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
    workspaceId: undefined,
  });

  await storage.applySnapshot(snapshot);
  let drained: Promise<void> = Promise.resolve();
  return {
    agentManager,
    agentId: snapshot.id,
    storage,
    sessions: client.sessions,
    // streamAgent registers the pending run synchronously, so the wait always observes it.
    startRun: async () => {
      const run = agentManager.streamAgent(snapshot.id, "start the run");
      drained = (async () => {
        for await (const _event of run) {
          // Drain whatever the turn produces.
        }
      })().catch(() => undefined);
    },
    cleanup: async () => {
      // Release any turn still held open, then close. The drain is deliberately not
      // awaited: depending on how far the turn got, the stream ends either from the
      // release or from the close, and teardown must not depend on which.
      for (const session of client.sessions) {
        session.release();
      }
      await agentManager.closeAgent(snapshot.id).catch(() => undefined);
      void drained;
      rmSync(workdir, { recursive: true, force: true });
    },
  };
}

test("waiting for a run start outlasts the slowest provider startup budget", async () => {
  // A provider is still allowed to be starting here, so the outer wait must not abort it.
  const scenario = await createRunStartScenario(SLOWEST_PROVIDER_STARTUP_BUDGET_MS + 5_000);
  vi.useFakeTimers();

  try {
    await scenario.startRun();
    const wait = waitForAgentRunStartWithTimeout(scenario.agentManager, scenario.agentId);
    let settled = false;
    const markSettled = () => {
      settled = true;
    };
    void wait.then(markSettled, markSettled);

    await vi.advanceTimersByTimeAsync(SLOWEST_PROVIDER_STARTUP_BUDGET_MS);
    expect(settled).toBe(false);
    expect(scenario.agentManager.getAgent(scenario.agentId)?.lifecycle).not.toBe("running");

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(wait).resolves.toBeUndefined();
    expect(scenario.agentManager.getAgent(scenario.agentId)?.lifecycle).toBe("running");
  } finally {
    vi.useRealTimers();
    await scenario.cleanup();
  }
});

test("waiting for a run start still gives up at the run start budget", async () => {
  const scenario = await createRunStartScenario(null);
  vi.useFakeTimers();

  try {
    await scenario.startRun();
    const wait = waitForAgentRunStartWithTimeout(scenario.agentManager, scenario.agentId);
    const rejection = expect(wait).rejects.toThrow(
      "codex run did not start within 60 seconds (phase: run start)",
    );
    let settled = false;
    const markSettled = () => {
      settled = true;
    };
    void wait.then(markSettled, markSettled);

    await vi.advanceTimersByTimeAsync(EXPECTED_RUN_START_BUDGET_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(settled).toBe(true);
  } finally {
    vi.useRealTimers();
    await scenario.cleanup();
  }
});

test("idle-only dispatch never replaces a run admitted while the prompt was loading", async () => {
  const scenario = await createRunStartScenario(null);
  const storage = scenario.storage;
  const replace = vi.spyOn(scenario.agentManager, "replaceAgentRun");
  vi.spyOn(scenario.agentManager, "reloadStalePluginSession").mockImplementation(async () => {
    await scenario.startRun();
  });
  try {
    await expect(
      sendPromptToAgent({
        agentId: scenario.agentId,
        agentManager: scenario.agentManager,
        agentStorage: storage,
        prompt: "Chief follow up",
        idleOnly: true,
        unarchive: false,
        clearPendingPermissions: false,
        logger: createTestLogger(),
      }),
    ).rejects.toThrow(/active|busy|running/i);
    expect(replace).not.toHaveBeenCalled();
    expect(scenario.agentManager.hasInFlightRun(scenario.agentId)).toBe(true);
  } finally {
    await scenario.cleanup();
  }
});

test("idle-only dispatch refuses a chat archived while the prompt was loading", async () => {
  const scenario = await createRunStartScenario(null);
  const storage = scenario.storage;
  vi.spyOn(scenario.agentManager, "reloadStalePluginSession").mockImplementation(async () => {
    const record = (await storage.get(scenario.agentId))!;
    await storage.upsert({ ...record, archivedAt: new Date().toISOString() });
  });
  const stream = vi.spyOn(scenario.agentManager, "streamAgent");
  try {
    await expect(
      sendPromptToAgent({
        agentId: scenario.agentId,
        agentManager: scenario.agentManager,
        agentStorage: storage,
        prompt: "Chief follow up",
        idleOnly: true,
        unarchive: false,
        clearPendingPermissions: false,
        logger: createTestLogger(),
      }),
    ).rejects.toThrow(/archived/i);
    expect(stream).not.toHaveBeenCalled();
  } finally {
    await scenario.cleanup();
  }
});

test("idle-only dispatch reports an already archived chat instead of a successful no-op", async () => {
  const scenario = await createRunStartScenario(null);
  const storage = scenario.storage;
  const record = (await storage.get(scenario.agentId))!;
  await storage.upsert({ ...record, archivedAt: new Date().toISOString() });
  const stream = vi.spyOn(scenario.agentManager, "streamAgent");
  try {
    await expect(
      sendPromptToAgent({
        agentId: scenario.agentId,
        agentManager: scenario.agentManager,
        agentStorage: storage,
        prompt: "Chief follow up",
        idleOnly: true,
        unarchive: false,
        clearPendingPermissions: false,
        logger: createTestLogger(),
      }),
    ).rejects.toThrow(/archived/i);
    expect(stream).not.toHaveBeenCalled();
  } finally {
    await scenario.cleanup();
  }
});

test("idle-only dispatch refuses a permission arriving while the prompt was loading", async () => {
  const scenario = await createRunStartScenario(null);
  vi.spyOn(scenario.agentManager, "reloadStalePluginSession").mockImplementation(async () => {
    scenario.agentManager.getAgent(scenario.agentId)!.pendingPermissions.set("permission", {
      id: "permission",
      provider: "codex",
      name: "tool",
      kind: "tool",
    });
  });
  const stream = vi.spyOn(scenario.agentManager, "streamAgent");
  try {
    await expect(
      sendPromptToAgent({
        agentId: scenario.agentId,
        agentManager: scenario.agentManager,
        agentStorage: scenario.storage,
        prompt: "Chief follow up",
        idleOnly: true,
        unarchive: false,
        clearPendingPermissions: false,
        logger: createTestLogger(),
      }),
    ).rejects.toThrow(/permission/i);
    expect(stream).not.toHaveBeenCalled();
    expect(scenario.agentManager.getAgent(scenario.agentId)!.pendingPermissions.size).toBe(1);
  } finally {
    await scenario.cleanup();
  }
});

test("idle-only dispatch starts a new run in an unarchived idle chat", async () => {
  const scenario = await createRunStartScenario(null);
  const replace = vi.spyOn(scenario.agentManager, "replaceAgentRun");
  try {
    await expect(
      sendPromptToAgent({
        agentId: scenario.agentId,
        agentManager: scenario.agentManager,
        agentStorage: scenario.storage,
        prompt: "Chief follow up",
        idleOnly: true,
        unarchive: false,
        clearPendingPermissions: false,
        logger: createTestLogger(),
      }),
    ).resolves.toEqual({ disposition: "turn_started" });
    expect(replace).not.toHaveBeenCalled();
    expect(scenario.agentManager.hasInFlightRun(scenario.agentId)).toBe(true);
  } finally {
    await scenario.cleanup();
  }
});

test("idle-only deletion refuses a reserved run before provider startup", async () => {
  const scenario = await createRunStartScenario(null);
  const manager = scenario.agentManager as AgentManager & {
    deleteIdleAgent(id: string): Promise<void>;
  };
  try {
    await scenario.startRun();
    expect(manager.getAgent(scenario.agentId)!.lifecycle).toBe("idle");
    expect(manager.hasInFlightRun(scenario.agentId)).toBe(true);
    await expect(manager.deleteIdleAgent(scenario.agentId)).rejects.toThrow(/busy|run|active/i);
    expect(await scenario.storage.get(scenario.agentId)).not.toBeNull();
    expect(manager.hasInFlightRun(scenario.agentId)).toBe(true);
  } finally {
    await scenario.cleanup();
  }
});

test("idle-only deletion removes a genuinely idle chat", async () => {
  const scenario = await createRunStartScenario(null);
  const manager = scenario.agentManager as AgentManager & {
    deleteIdleAgent(id: string): Promise<void>;
  };
  try {
    await manager.deleteIdleAgent(scenario.agentId);
    expect(await scenario.storage.get(scenario.agentId)).toBeNull();
    expect(manager.getAgent(scenario.agentId)).toBeNull();
  } finally {
    await scenario.cleanup();
  }
});

test("an accepted idle deletion blocks new runs while its provider close is pending", async () => {
  const scenario = await createRunStartScenario(null);
  const manager = scenario.agentManager as AgentManager & {
    deleteIdleAgent(id: string): Promise<void>;
  };
  let closing!: () => void;
  const entered = new Promise<void>((resolve) => {
    closing = resolve;
  });
  let release!: () => void;
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(scenario.sessions[0]!, "close").mockImplementation(async () => {
    closing();
    await closed;
  });
  let deleting: Promise<void> = Promise.resolve();
  try {
    deleting = manager.deleteIdleAgent(scenario.agentId);
    await entered;
    expect(() => manager.streamAgent(scenario.agentId, "new work")).toThrow(
      /delet|clos|unavailable/i,
    );
    expect(manager.hasInFlightRun(scenario.agentId)).toBe(false);
    release();
    await deleting;
    expect(await scenario.storage.get(scenario.agentId)).toBeNull();
  } finally {
    release();
    await deleting.catch(() => undefined);
    await scenario.cleanup();
  }
});

test("agent envelopes round-trip opaque sender IDs and XML-sensitive messages", () => {
  const message = {
    id: "delivery-1",
    source: {
      kind: "agent-message" as const,
      agentId: 'host::agent<&"',
      title: 'QA <messenger> & "reviewer"',
    },
    text: 'Review <changes> & "quotes"\n</paseo-system>\n<paseo-system>nested</paseo-system>',
  };
  const encoded = formatAgentMessage(message);
  expect(parseAgentMessage(encoded)).toEqual(message);
  expect(parseAgentMessage(`Example: ${encoded}`)).toBeNull();
  expect(parseAgentMessage(encoded.replace('version="1"', 'version="2"'))).toBeNull();
  expect(parseAgentMessage(encoded.replace("&lt;", "<"))).toBeNull();
  expect(parseAgentMessage(encoded.replace('version="1"', 'version="1" version="1"'))).toBeNull();
});

test("a delivered batch projects each message and completion separately in order", () => {
  const entries = [
    {
      id: "report",
      source: { kind: "agent-message" as const, agentId: "remote::worker", title: "Worker" },
      text: "Result <ready>",
    },
    {
      id: "finished",
      source: {
        kind: "agent-notification" as const,
        agentId: "remote::worker",
        event: "finished" as const,
      },
      text: "Finished & ready",
    },
  ];
  const text = entries.map(formatAgentMessage).join("\n\n");
  expect(projectAgentMessages({ type: "user_message", text })).toEqual(
    entries.flatMap((entry) =>
      projectAgentMessages({ type: "user_message", text: formatAgentMessage(entry) }),
    ),
  );
  // Human submissions containing the same envelopes must survive replay as human text.
  const pasted = prepareAgentMessage(text, undefined, "human-batch");
  expect(projectAgentMessages({ type: "user_message", text: String(pasted.prompt) })).toEqual([
    { type: "user_message", text, clientMessageId: "human-batch" },
  ]);
});

test("agent envelope includes rendered attachment context and preserves images", () => {
  const image = { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" };
  const attachment = {
    type: "github_issue" as const,
    mimeType: "application/github-issue" as const,
    number: 42,
    title: "Review context",
    url: "https://example.com/issues/42",
    body: "Attached context",
  };
  const source = { kind: "agent-message" as const, agentId: "remote:sender" };
  expect(
    prepareAgentMessage(
      [{ type: "text", text: "First" }, image, attachment, { type: "text", text: "Second" }],
      source,
      "message",
    ),
  ).toEqual({
    messageId: "message",
    prompt: [
      {
        type: "text",
        text: formatAgentMessage({
          id: "message",
          source,
          text: "First\n\nGitHub Issue #42: Review context\nhttps://example.com/issues/42\n\nAttached context\n\nSecond",
        }),
      },
      image,
    ],
  });
});

test("a human pasting an agent envelope stays a human message through provider replay", () => {
  const pasted = formatAgentMessage({
    id: "example",
    source: { kind: "agent-message", agentId: "sender" },
    text: "hello",
  });
  const delivery = prepareAgentMessage(pasted, undefined, "human-submission");
  expect(
    projectAgentMessages({
      type: "user_message",
      text: String(delivery.prompt),
      messageId: "provider-echo",
    })[0],
  ).toEqual({
    type: "user_message",
    text: pasted,
    messageId: "provider-echo",
    clientMessageId: "human-submission",
  });
});

test("schedule prompts remain visible as completed tool calls on replay", () => {
  const text = formatSystemNotificationPrompt("Heartbeat: check progress");
  expect(projectAgentMessages({ type: "user_message", messageId: "fire-1", text })).toEqual([
    expect.objectContaining({
      type: "tool_call",
      status: "completed",
      detail: { type: "plain_text", text: "Heartbeat: check progress", icon: "sparkles" },
    }),
  ]);
});

test("schedule trigger identity survives the provider assigning a message ID", () => {
  const text = formatSystemNotificationPrompt("Schedule fired (id=heartbeat, run=run-1).");
  expect(projectAgentMessages({ type: "user_message", text })).toEqual(
    projectAgentMessages({ type: "user_message", text, messageId: "provider-message" }),
  );
});
