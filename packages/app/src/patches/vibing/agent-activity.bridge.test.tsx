// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { providerSubagentKey, useProviderSubagentStore } from "@/subagents/provider-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import { EmbeddedAgentActivityBridge } from "./agent-activity";

vi.mock("./workspace-boundary", () => ({
  useEmbeddedWorkspace: () => ({ serverId: "local", workspaceId: "feature" }),
  isEmbeddedWorkspaceAllowed: (_serverId: string, workspaceId: string) => workspaceId === "feature",
}));
vi.mock("./focus-mode", () => ({ isEmbeddedLiveDesignMessaging: false }));
vi.mock("@/constants/platform", () => ({ isWeb: true, isNative: false }));

afterEach(() => {
  cleanup();
  useSessionStore.setState({ sessions: {} });
  useProviderSubagentStore.setState({ descriptors: new Map() });
  vi.restoreAllMocks();
});

it("publishes related-work changes while the parent stays idle, scoped to its host", async () => {
  const postMessage = vi.fn();
  vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage } as unknown as Window);
  const parent = {
    id: "chat",
    workspaceId: "feature",
    labels: {},
    turn: { phase: "idle", cancellationRequestId: null },
  } as Agent;
  const snapshot = (agent: Agent): SessionState =>
    ({
      agents: new Map([[agent.id, agent]]),
      agentDetails: new Map(),
      messageSubmissions: new Map(),
    }) as unknown as SessionState;
  useSessionStore.setState({ sessions: { local: snapshot(parent) } });
  useProviderSubagentStore.setState({ descriptors: new Map() });
  render(<EmbeddedAgentActivityBridge />);
  const running = () => postMessage.mock.calls.at(-1)?.[0].running;
  expect(running()).toBe(false);
  await act(() =>
    useSessionStore.setState({
      sessions: { local: snapshot({ ...parent, backgroundWork: { count: 1 } }) },
    }),
  );
  expect(running()).toBe(true);
  await act(() => useSessionStore.setState({ sessions: { local: snapshot(parent) } }));
  expect(running()).toBe(false);
  const child = {
    id: "child",
    parentAgentId: "chat",
    status: "running",
  } as ProviderSubagentDescriptorPayload;
  await act(() =>
    useProviderSubagentStore.setState({
      descriptors: new Map([[providerSubagentKey("other", "chat", "child"), child]]),
    }),
  );
  expect(running()).toBe(false);
  await act(() =>
    useProviderSubagentStore.setState({
      descriptors: new Map([[providerSubagentKey("local", "chat", "child"), child]]),
    }),
  );
  expect(running()).toBe(true);
  await act(() =>
    useProviderSubagentStore.setState({
      descriptors: new Map([
        [providerSubagentKey("local", "chat", "child"), { ...child, status: "completed" }],
      ]),
    }),
  );
  expect(running()).toBe(false);
});
