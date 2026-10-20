// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  activate: undefined as ((agentId?: string, newChat?: boolean) => string | void) | undefined,
  agents: new Map([
    ["existing", { cwd: "/worktree", labels: { "paseo-bots.bot": "reviewer" } }],
    ["foreign", { cwd: "/other", labels: {} }],
    ["legacy", { cwd: "/worktree", labels: {} }],
  ]),
}));
vi.mock("./workspace-boundary", () => ({
  useEmbeddedWorkspace: () => ({ serverId: "host", workspaceId: "workspace" }),
  getEmbeddedWorkspaceDirectory: () => "/worktree",
}));
vi.mock("@/stores/session-store", () => {
  const state = () => ({
    sessions: { host: { agents: fake.agents, agentDetails: new Map(), hasHydratedAgents: true } },
  });
  return {
    useSessionStore: Object.assign(
      (selector: (value: ReturnType<typeof state>) => unknown) => selector(state()),
      { getState: state },
    ),
  };
});
vi.mock("./host-prompts", () => ({ useEmbeddedPromptActivation: () => {} }));
vi.mock("./live-design", () => ({
  useEmbeddedLiveDesignActivation: (input: { activateConversation: typeof fake.activate }) => {
    fake.activate = input.activateConversation;
  },
}));
import { BotWorkspaceBridge } from "./bot-workspace";
const LAST_CHAT = "vibing:paseo-bots:last-chat:/worktree";
// Node's own localStorage global shadows jsdom's, so give the bridge a plain store.
beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  });
});
it("resumes the owning bot only in the bound worktree and routes legacy chats to General", () => {
  const activate = vi.fn();
  renderHook(() => BotWorkspaceBridge({ botId: "reviewer", onActivate: activate }));
  fake.activate!("existing");
  expect(activate).toHaveBeenLastCalledWith({ botId: "reviewer", agentId: "existing" });
  fake.activate!("foreign");
  expect(activate).toHaveBeenCalledTimes(1);
  fake.activate!("legacy");
  expect(activate).toHaveBeenLastCalledWith({ botId: "vibing-general", agentId: "legacy" });
});
it("gives each fresh Live Design conversation a distinct composer for its handshake", () => {
  const activate = vi.fn();
  renderHook(() => BotWorkspaceBridge({ botId: "reviewer", onActivate: activate }));
  const first = fake.activate!(undefined, true);
  const second = fake.activate!(undefined, true);
  expect(first).toMatch(/^paseo-bots:reviewer:workspace:/);
  expect(second).not.toBe(first);
  expect(activate).toHaveBeenLastCalledWith({ draftId: second });
});

it("opens a workspace draft before accepting a host prompt from another folder's history", () => {
  const activate = vi.fn();
  renderHook(() =>
    BotWorkspaceBridge({ botId: "reviewer", selectedAgentId: "foreign", onActivate: activate }),
  );
  fake.activate!();
  expect(activate).toHaveBeenCalledWith({
    draftId: expect.stringMatching(/^paseo-bots:reviewer:workspace:/),
  });
});

it("reopens the worktree's last chat when the surface remounts", () => {
  const first = renderHook(
    ({ selected }) =>
      BotWorkspaceBridge({ botId: "reviewer", selectedAgentId: selected, onActivate: vi.fn() }),
    { initialProps: { selected: null as string | null } },
  );
  first.rerender({ selected: "existing" });
  first.unmount();
  expect(localStorage.getItem(LAST_CHAT)).toBe(JSON.stringify("existing"));

  const activate = vi.fn();
  renderHook(() => BotWorkspaceBridge({ botId: "vibing-general", onActivate: activate }));
  expect(activate).toHaveBeenCalledWith({ botId: "reviewer", agentId: "existing" });
});

it("keeps a new chat when it was the last view or the saved chat left the worktree", () => {
  const activate = vi.fn();
  localStorage.setItem(LAST_CHAT, JSON.stringify(null));
  renderHook(() => BotWorkspaceBridge({ botId: "reviewer", onActivate: activate }));
  localStorage.setItem(LAST_CHAT, JSON.stringify("foreign"));
  renderHook(() => BotWorkspaceBridge({ botId: "reviewer", onActivate: activate }));
  expect(activate).not.toHaveBeenCalled();
});

it("does not override a chat the surface already selected", () => {
  const activate = vi.fn();
  localStorage.setItem(LAST_CHAT, JSON.stringify("existing"));
  renderHook(() =>
    BotWorkspaceBridge({ botId: "reviewer", selectedAgentId: "legacy", onActivate: activate }),
  );
  expect(activate).not.toHaveBeenCalled();
  expect(localStorage.getItem(LAST_CHAT)).toBe(JSON.stringify("legacy"));
});
