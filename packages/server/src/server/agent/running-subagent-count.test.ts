import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { AgentManager, type AgentManagerEvent, type ManagedAgent } from "./agent-manager.js";
import type { ProviderSubagentDescriptor } from "./provider-subagents/store.js";
import { Session } from "../session.js";
import {
  asAgentManager,
  asAgentStorage,
  asCheckoutDiffManager,
  asDaemonConfigStore,
  asDownloadTokenStore,
  asGitHubService,
  asPushNotifications,
  asScheduleService,
  asWorkspaceGitService,
  createAgentMessageDeliveryStub,
  createMessageReceiptsStub,
  createProviderSnapshotManagerStub,
  createTestCreationService,
} from "../test-utils/session-stubs.js";
import { createWorkspaceRuntimeStore } from "../workspace-runtime-store/index.js";
import { OWNER_PERMISSIONS } from "../authorization/index.js";

function makeManagedAgent(
  overrides: Partial<ManagedAgent> & Pick<ManagedAgent, "id">,
): ManagedAgent {
  const now = new Date("2026-08-01T10:00:00.000Z");
  return {
    provider: "claude",
    cwd: "/tmp/repo",
    workspaceId: "ws-1",
    config: { provider: "claude", cwd: "/tmp/repo" },
    session: {} as ManagedAgent["session"],
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: null,
    lifecycle: "idle",
    activeTurnId: null,
    activeTurnStartedAt: null,
    activeForegroundTurnId: null,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: true,
      supportsRewindConversation: false,
      supportsRewindFiles: false,
      supportsRewindBoth: false,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: new Map(),
    persistence: null,
    runtimeInfo: undefined,
    lastUsage: undefined,
    lastError: undefined,
    labels: {},
    metadata: undefined,
    attention: { requiresAttention: false },
    internal: false,
    background: false,
    ...overrides,
  } as ManagedAgent;
}

describe("AgentManager.getRunningSubagentCount", () => {
  it("counts running provider subagents and running child agents (including background work and nesting)", () => {
    const manager = new AgentManager({
      clients: {},
      logger: pino({ level: "silent" }),
    });
    const internal = manager as unknown as {
      agents: Map<string, ManagedAgent>;
      providerSubagents: {
        apply(
          parentAgentId: string,
          provider: "claude",
          event: { type: "upsert"; id: string; status: "running" | "completed" },
        ): void;
      };
      backgroundWork: {
        apply(
          agentId: string,
          items: Array<{ id: string; kind: string; description: string }>,
        ): void;
      };
    };

    const parent = makeManagedAgent({ id: "parent" });
    const runningChild = makeManagedAgent({
      id: "child-running",
      lifecycle: "running",
      labels: { [PARENT_AGENT_ID_LABEL]: "parent" },
    });
    const bgChild = makeManagedAgent({
      id: "child-bg",
      lifecycle: "idle",
      background: true,
      labels: { [PARENT_AGENT_ID_LABEL]: "parent" },
    });
    const idleChild = makeManagedAgent({
      id: "child-idle",
      lifecycle: "idle",
      labels: { [PARENT_AGENT_ID_LABEL]: "parent" },
    });
    const nestedRunning = makeManagedAgent({
      id: "grandchild",
      lifecycle: "running",
      labels: { [PARENT_AGENT_ID_LABEL]: "child-idle" },
    });

    internal.agents.set(parent.id, parent);
    internal.agents.set(runningChild.id, runningChild);
    internal.agents.set(bgChild.id, bgChild);
    internal.agents.set(idleChild.id, idleChild);
    internal.agents.set(nestedRunning.id, nestedRunning);

    internal.backgroundWork.apply(bgChild.id, [
      { id: "shell-1", kind: "shell", description: "Watch tests" },
    ]);
    internal.providerSubagents.apply(parent.id, "claude", {
      type: "upsert",
      id: "provider-1",
      status: "running",
    });
    internal.providerSubagents.apply(parent.id, "claude", {
      type: "upsert",
      id: "provider-done",
      status: "completed",
    });

    // 1 running provider subagent + 3 running children (runningChild, bgChild, idleChild via grandchild)
    expect(manager.getRunningSubagentCount(parent.id)).toBe(4);

    // Completing provider-1 and grandchild drops parent count accordingly
    internal.providerSubagents.apply(parent.id, "claude", {
      type: "upsert",
      id: "provider-1",
      status: "completed",
    });
    nestedRunning.lifecycle = "idle";
    expect(manager.getRunningSubagentCount(parent.id)).toBe(2);

    runningChild.lifecycle = "idle";
    internal.backgroundWork.apply(bgChild.id, []);
    expect(manager.getRunningSubagentCount(parent.id)).toBe(0);
  });
});

describe("Session runningSubagentCount propagation", () => {
  it("forwards parent agent_update when provider subagent running count changes", async () => {
    const emitted: SessionOutboundMessage[] = [];
    const parent = makeManagedAgent({ id: "parent" });
    let runningCount = 0;
    let listener: ((event: AgentManagerEvent) => void) | null = null;

    const workspace = {
      workspaceId: "ws-1",
      projectId: "proj-1",
      cwd: "/tmp/repo",
      kind: "checkout" as const,
      displayName: "repo",
      title: null,
      branch: "main",
      baseBranch: null,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
      archivedAt: null,
    };
    const project = {
      projectId: "proj-1",
      rootPath: "/tmp/repo",
      kind: "git" as const,
      displayName: "repo",
      customName: null,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
      archivedAt: null,
    };

    const session = new Session({
      clientId: "test-client",
      workspaceRuntimeStore: createWorkspaceRuntimeStore(),
      messageReceipts: createMessageReceiptsStub(),
      agentMessages: createAgentMessageDeliveryStub(),
      creationService: createTestCreationService(),
      onMessage: (message) => emitted.push(message),
      onMessageToSource: (_source, message) => emitted.push(message),
      logger: pino({ level: "silent" }),
      downloadTokenStore: asDownloadTokenStore(),
      pushNotifications: asPushNotifications(),
      paseoHome: "/tmp/paseo-home",
      agentManager: asAgentManager({
        listAgents: () => [parent],
        getAgent: (id: string) => (id === parent.id ? parent : null),
        getRunningSubagentCount: (id: string) => (id === parent.id ? runningCount : 0),
        subscribe: (next: (event: AgentManagerEvent) => void) => {
          listener = next;
          return () => {};
        },
      }),
      agentStorage: asAgentStorage({
        get: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        listAll: vi.fn().mockResolvedValue([]),
      }),
      projectRegistry: {
        list: vi.fn().mockResolvedValue([project]),
        get: vi.fn().mockResolvedValue(project),
        getOrCreateActiveByRoot: vi.fn(),
        upsert: vi.fn(),
        archive: vi.fn(),
        remove: vi.fn(),
        initialize: vi.fn(),
        existsOnDisk: vi.fn(),
      } as never,
      workspaceRegistry: {
        get: vi.fn().mockResolvedValue(workspace),
        list: vi.fn().mockResolvedValue([workspace]),
        listAll: vi.fn().mockResolvedValue([workspace]),
        listActive: vi.fn().mockResolvedValue([workspace]),
      } as never,
      scheduleService: asScheduleService(),
      checkoutDiffManager: asCheckoutDiffManager({}),
      github: asGitHubService({}),
      workspaceGitService: asWorkspaceGitService({
        getCheckout: vi.fn().mockResolvedValue(null),
        getSnapshot: vi.fn().mockResolvedValue(null),
      }),
      daemonConfigStore: asDaemonConfigStore({
        readServicePorts: async () => undefined,
        get: vi.fn(() => ({ mcp: { injectIntoAgents: false }, providers: {} })),
        onChange: vi.fn(() => () => {}),
      }),
      stt: null,
      tts: null,
      terminalManager: null,
      providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      permissions: OWNER_PERMISSIONS,
    });

    await session.handleMessage({
      type: "fetch_agents_request",
      requestId: "req-1",
      subscribe: { subscriptionId: "sub-agents" },
    });
    expect(emitted).toContainEqual(expect.objectContaining({ type: "fetch_agents_response" }));
    expect(listener).not.toBeNull();
    emitted.length = 0;

    const subagent: ProviderSubagentDescriptor = {
      id: "sub-1",
      parentAgentId: parent.id,
      parentSubagentId: null,
      provider: "claude",
      title: "Explore",
      description: "Scan files",
      status: "running",
      createdAt: "2026-08-01T10:01:00.000Z",
      updatedAt: "2026-08-01T10:01:00.000Z",
      toolCallId: null,
      cwd: "/tmp/repo",
      subtitle: null,
    };

    const parentUpserts = () =>
      emitted.filter(
        (msg): msg is Extract<SessionOutboundMessage, { type: "agent_update" }> =>
          msg.type === "agent_update" &&
          msg.payload.kind === "upsert" &&
          msg.payload.agent.id === parent.id,
      );

    runningCount = 1;
    listener?.({ type: "provider_subagent", event: { type: "upsert", subagent } });
    await vi.waitFor(() => {
      const last = parentUpserts().at(-1);
      expect(last?.payload.kind === "upsert" && last.payload.agent.runningSubagentCount).toBe(1);
    });

    // Presentation-only upsert with same running count must not emit another agent_update.
    const updatesBefore = parentUpserts().length;
    listener?.({
      type: "provider_subagent",
      event: { type: "upsert", subagent: { ...subagent, subtitle: "Step 2" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(parentUpserts().length).toBe(updatesBefore);

    // Completing the subagent clears runningSubagentCount on the parent.
    runningCount = 0;
    listener?.({
      type: "provider_subagent",
      event: { type: "upsert", subagent: { ...subagent, status: "completed" } },
    });
    await vi.waitFor(() => {
      const last = parentUpserts().at(-1);
      expect(last?.payload.kind).toBe("upsert");
      if (last?.payload.kind === "upsert") {
        expect(last.payload.agent.runningSubagentCount).toBeUndefined();
      }
    });
  });
});
