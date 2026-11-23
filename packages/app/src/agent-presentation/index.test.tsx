// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { providerSubagentKey, useProviderSubagentStore } from "@/subagents/provider-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import type { PanelDescriptor } from "@/panels/panel-registry";
import { buildAgentDescriptor, useAgentDescriptor } from "./index";

const MockIcon = () => null;

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n/i18next", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/components/provider-icons", () => ({ useProviderIcon: () => MockIcon }));

afterEach(() => {
  cleanup();
  useSessionStore.setState({ sessions: {} });
  useProviderSubagentStore.setState({ descriptors: new Map() });
});

function makeAgent(overrides: Partial<Agent> & Pick<Agent, "id">): Agent {
  return {
    serverId: "local",
    provider: "claude",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    lastUserMessageAt: null,
    lastActivityAt: new Date("2026-01-01T00:00:00Z"),
    capabilities: {} as Agent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: "Parent chat",
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
    requiresAttention: true,
    attentionReason: "finished",
    ...overrides,
  };
}

function makeSession(agents: Agent[]): SessionState {
  return {
    agents: new Map(agents.map((agent) => [agent.id, agent])),
    agentDetails: new Map(),
    messageSubmissions: new Map(),
  } as unknown as SessionState;
}

describe("buildAgentDescriptor", () => {
  it("marks an idle chat tab as running when it has running background work", () => {
    const descriptor = buildAgentDescriptor({
      provider: "codex",
      title: "Build task",
      status: "idle",
      backgroundWork: { count: 1 },
      pendingPermissionCount: 0,
      requiresAttention: true,
      attentionReason: "finished",
      isTurnActive: false,
      icon: MockIcon,
    });
    expect(descriptor.statusBucket).toBe("running");
  });

  it("marks an idle chat tab as running when it has running subagents", () => {
    const descriptor = buildAgentDescriptor({
      provider: "claude",
      title: "Parent chat",
      status: "idle",
      runningSubagentCount: 2,
      pendingPermissionCount: 0,
      requiresAttention: true,
      attentionReason: "finished",
      isTurnActive: false,
      icon: MockIcon,
    });
    expect(descriptor.statusBucket).toBe("running");
  });

  it("returns done when neither turn, background work, nor subagents are running", () => {
    const descriptor = buildAgentDescriptor({
      provider: "claude",
      title: "Parent chat",
      status: "idle",
      backgroundWork: { count: 0 },
      runningSubagentCount: 0,
      pendingPermissionCount: 0,
      requiresAttention: false,
      attentionReason: null,
      isTurnActive: false,
      icon: MockIcon,
    });
    expect(descriptor.statusBucket).toBe("done");
  });
});

describe("useAgentDescriptor", () => {
  it("shows running for provider subagents, Paseo child agents, and background tasks", async () => {
    let latest: PanelDescriptor | null = null;
    function Probe() {
      latest = useAgentDescriptor({ kind: "agent", agentId: "parent" }, { serverId: "local" });
      return null;
    }

    const parent = makeAgent({ id: "parent" });
    useSessionStore.setState({ sessions: { local: makeSession([parent]) } });
    render(<Probe />);
    expect(latest!.statusBucket).toBe("attention");

    // 1. Live provider subagent in provider-store
    const subagent = {
      id: "sub-1",
      parentAgentId: "parent",
      status: "running",
    } as ProviderSubagentDescriptorPayload;
    await act(() =>
      useProviderSubagentStore.setState({
        descriptors: new Map([[providerSubagentKey("local", "parent", "sub-1"), subagent]]),
      }),
    );
    expect(latest!.statusBucket).toBe("running");

    await act(() =>
      useProviderSubagentStore.setState({
        descriptors: new Map([
          [providerSubagentKey("local", "parent", "sub-1"), { ...subagent, status: "completed" }],
        ]),
      }),
    );
    expect(latest!.statusBucket).toBe("attention");

    // 2. Running Paseo child agent
    const child = makeAgent({ id: "child-1", parentAgentId: "parent", status: "running" });
    await act(() =>
      useSessionStore.setState({ sessions: { local: makeSession([parent, child]) } }),
    );
    expect(latest!.statusBucket).toBe("running");

    // 3. Server-reported runningSubagentCount (e.g. after reload before provider-store hydration)
    await act(() =>
      useSessionStore.setState({
        sessions: { local: makeSession([makeAgent({ id: "parent", runningSubagentCount: 1 })]) },
      }),
    );
    expect(latest!.statusBucket).toBe("running");

    // 4. Background task on parent
    await act(() =>
      useSessionStore.setState({
        sessions: {
          local: makeSession([makeAgent({ id: "parent", backgroundWork: { count: 1 } })]),
        },
      }),
    );
    expect(latest!.statusBucket).toBe("running");
  });
});
