// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  activate: undefined as ((agentId?: string, newChat?: boolean) => string | void) | undefined,
  hydrated: true,
  liveDesign: false,
  agents: new Map<
    string,
    { id: string; cwd: string; createdAt: Date; labels: Record<string, string> }
  >([
    [
      "existing",
      {
        id: "existing",
        cwd: "/worktree",
        createdAt: new Date("2026-01-01"),
        labels: { "paseo-bots.bot": "reviewer" },
      },
    ],
    ["foreign", { id: "foreign", cwd: "/other", createdAt: new Date("2026-03-01"), labels: {} }],
    ["legacy", { id: "legacy", cwd: "/worktree", createdAt: new Date("2026-02-01"), labels: {} }],
  ]),
}));
vi.mock("./focus-mode", () => ({
  get isEmbeddedLiveDesignMessaging() {
    return fake.liveDesign;
  },
}));
vi.mock("./workspace-boundary", () => ({
  useEmbeddedWorkspace: () => ({ serverId: "host", workspaceId: "workspace" }),
  getEmbeddedWorkspaceDirectory: () => "/worktree",
}));
vi.mock("@/stores/session-store", () => {
  const state = () => ({
    sessions: {
      host: { agents: fake.agents, agentDetails: new Map(), hasHydratedAgents: fake.hydrated },
    },
  });
  return {
    useSessionStore: Object.assign(
      (selector: (value: ReturnType<typeof state>) => unknown) => selector(state()),
      { getState: state },
    ),
  };
});
vi.mock("./host-messages", async (original) => ({
  ...(await original<typeof import("./host-messages")>()),
  getEmbeddedHostOrigin: () => "http://host",
}));
vi.mock("./host-prompts", () => ({ useEmbeddedPromptActivation: () => {} }));
vi.mock("./live-design", () => ({
  useEmbeddedLiveDesignActivation: (input: { activateConversation: typeof fake.activate }) => {
    fake.activate = input.activateConversation;
  },
}));
import { BotWorkspaceBridge } from "./bot-workspace";
const localBotIds = ["reviewer", "vibing-general"];
const LAST_CHAT = "vibing:paseo-bots:last-chat:/worktree";
// Node's own localStorage global shadows jsdom's, so give the bridge a plain store.
beforeEach(() => {
  fake.hydrated = true;
  fake.liveDesign = false;
  fake.agents.delete("design");
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
});
it("resumes the owning bot only in the bound worktree and routes legacy chats to General", () => {
  const activate = vi.fn();
  renderHook(() => BotWorkspaceBridge({ localBotIds, botId: "reviewer", onActivate: activate }));
  fake.activate!("existing");
  expect(activate).toHaveBeenLastCalledWith({ botId: "reviewer", agentId: "existing" });
  fake.activate!("foreign");
  expect(activate).toHaveBeenLastCalledWith({ botId: "reviewer", agentId: "existing" });
  fake.activate!("legacy");
  expect(activate).toHaveBeenLastCalledWith({ botId: "vibing-general", agentId: "legacy" });
});
it("gives each fresh Live Design conversation a distinct composer for its handshake", () => {
  const activate = vi.fn();
  renderHook(() => BotWorkspaceBridge({ localBotIds, botId: "reviewer", onActivate: activate }));
  const first = fake.activate!(undefined, true);
  const second = fake.activate!(undefined, true);
  expect(first).toMatch(/^paseo-bots:reviewer:workspace:/);
  expect(second).not.toBe(first);
  expect(activate).toHaveBeenLastCalledWith({ draftId: second });
});

it("opens a workspace draft before accepting a host prompt from another folder's history", () => {
  const activate = vi.fn();
  renderHook(() =>
    BotWorkspaceBridge({
      localBotIds,
      botId: "reviewer",
      selectedAgentId: "foreign",
      onActivate: activate,
    }),
  );
  fake.activate!();
  expect(activate).toHaveBeenCalledWith({
    draftId: expect.stringMatching(/^paseo-bots:reviewer:workspace:/),
  });
});

it("reopens the worktree's last chat when the surface remounts", () => {
  const first = renderHook(
    ({ selected }) =>
      BotWorkspaceBridge({
        localBotIds,
        botId: "reviewer",
        selectedAgentId: selected,
        onActivate: vi.fn(),
      }),
    { initialProps: { selected: null as string | null } },
  );
  first.rerender({ selected: "existing" });
  first.unmount();
  expect(localStorage.getItem(LAST_CHAT)).toBe(JSON.stringify("existing"));

  const activate = vi.fn();
  renderHook(() =>
    BotWorkspaceBridge({ localBotIds, botId: "vibing-general", onActivate: activate }),
  );
  expect(activate).toHaveBeenCalledWith({ botId: "reviewer", agentId: "existing" });
});

it.each([null, "foreign", "deleted"])(
  "opens the newest worktree chat when saved selection %s cannot restore",
  (saved) => {
    const activate = vi.fn();
    localStorage.setItem(LAST_CHAT, JSON.stringify(saved));
    renderHook(() => BotWorkspaceBridge({ localBotIds, botId: "reviewer", onActivate: activate }));
    expect(activate).toHaveBeenCalledWith({ botId: "vibing-general", agentId: "legacy" });
  },
);

it("preserves the last active chat when an explicit New Chat draft is opened", () => {
  const view = renderHook(
    ({ selected }) =>
      BotWorkspaceBridge({
        localBotIds,
        botId: "reviewer",
        selectedAgentId: selected,
        onActivate: vi.fn(),
      }),
    { initialProps: { selected: "existing" as string | null } },
  );
  view.rerender({ selected: null });
  expect(localStorage.getItem(LAST_CHAT)).toBe(JSON.stringify("existing"));
});

it("keeps an explicit New Chat after a warm workspace switch", () => {
  const activate = vi.fn();
  const view = renderHook(
    ({ selected }) =>
      BotWorkspaceBridge({
        localBotIds,
        botId: "reviewer",
        selectedAgentId: selected,
        onActivate: activate,
      }),
    { initialProps: { selected: "existing" as string | null } },
  );
  view.rerender({ selected: null });
  expect(activate).not.toHaveBeenCalled();
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        origin: "http://host",
        data: { type: "space:paseo-workspace-activated" },
      }),
    ),
  );
  expect(activate).toHaveBeenCalledWith({
    botId: "reviewer",
    draftId: "paseo-bots:reviewer:workspace",
  });
});

it("restores the exact unsent draft and its bot after the feature unmounts", () => {
  const first = renderHook(
    ({ selected }) =>
      BotWorkspaceBridge({
        localBotIds,
        botId: "reviewer",
        selectedAgentId: selected,
        selectedDraftId: "paseo-bots:reviewer:workspace:live-design",
        onActivate: vi.fn(),
      }),
    { initialProps: { selected: "existing" as string | null } },
  );
  first.rerender({ selected: null });
  first.unmount();
  const activate = vi.fn();
  renderHook(() =>
    BotWorkspaceBridge({ localBotIds, botId: "vibing-general", onActivate: activate }),
  );
  expect(activate).toHaveBeenCalledWith({
    botId: "reviewer",
    draftId: "paseo-bots:reviewer:workspace:live-design",
  });
});

it("stops restoring an unsent draft after the user selects a started chat", () => {
  const first = renderHook(
    ({ selected }) =>
      BotWorkspaceBridge({
        localBotIds,
        botId: "reviewer",
        selectedAgentId: selected,
        onActivate: vi.fn(),
      }),
    { initialProps: { selected: "existing" as string | null } },
  );
  first.rerender({ selected: null });
  first.rerender({ selected: "existing" });
  first.unmount();
  const activate = vi.fn();
  renderHook(() =>
    BotWorkspaceBridge({ localBotIds, botId: "vibing-general", onActivate: activate }),
  );
  expect(activate).toHaveBeenCalledWith({ botId: "reviewer", agentId: "existing" });
});

it("waits for hydration before choosing a fallback", () => {
  fake.hydrated = false;
  const activate = vi.fn();
  const view = renderHook(() =>
    BotWorkspaceBridge({ localBotIds, botId: "reviewer", onActivate: activate }),
  );
  expect(activate).not.toHaveBeenCalled();
  fake.hydrated = true;
  view.rerender();
  expect(activate).toHaveBeenCalledWith({ botId: "vibing-general", agentId: "legacy" });
});

it("leaves New Chat open only when the worktree has no unarchived chats", () => {
  const agents = Array.from(fake.agents.entries());
  fake.agents.clear();
  try {
    const activate = vi.fn();
    renderHook(() => BotWorkspaceBridge({ localBotIds, botId: "reviewer", onActivate: activate }));
    expect(activate).toHaveBeenCalledWith({
      botId: "reviewer",
      draftId: "paseo-bots:reviewer:workspace",
    });
  } finally {
    for (const [id, agent] of agents) fake.agents.set(id, agent);
  }
});

it("ignores activation messages from other origins", () => {
  const activate = vi.fn();
  const view = renderHook(
    ({ selected }) =>
      BotWorkspaceBridge({
        localBotIds,
        botId: "reviewer",
        selectedAgentId: selected,
        onActivate: activate,
      }),
    { initialProps: { selected: "existing" as string | null } },
  );
  view.rerender({ selected: null });
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        origin: "http://other",
        data: { type: "space:paseo-workspace-activated" },
      }),
    ),
  );
  expect(activate).not.toHaveBeenCalled();
});

it("does not override a chat the surface already selected", () => {
  const activate = vi.fn();
  localStorage.setItem(LAST_CHAT, JSON.stringify("existing"));
  renderHook(() =>
    BotWorkspaceBridge({
      localBotIds,
      botId: "reviewer",
      selectedAgentId: "legacy",
      onActivate: activate,
    }),
  );
  expect(activate).not.toHaveBeenCalled();
  expect(localStorage.getItem(LAST_CHAT)).toBe(JSON.stringify("legacy"));
});

it("skips chats whose bot was deleted or moved to a remote host", () => {
  const activate = vi.fn();
  localStorage.setItem(LAST_CHAT, JSON.stringify("existing"));
  renderHook(() =>
    BotWorkspaceBridge({
      botId: "vibing-general",
      localBotIds: ["vibing-general"],
      onActivate: activate,
    }),
  );
  expect(activate).toHaveBeenCalledWith({ botId: "vibing-general", agentId: "legacy" });
});

it("waits for the bot inventory before consuming restoration", () => {
  const activate = vi.fn();
  localStorage.setItem(LAST_CHAT, JSON.stringify("existing"));
  const view = renderHook(
    ({ ids }) =>
      BotWorkspaceBridge({ botId: "vibing-general", localBotIds: ids, onActivate: activate }),
    { initialProps: { ids: undefined as readonly string[] | undefined } },
  );
  expect(activate).not.toHaveBeenCalled();
  view.rerender({ ids: localBotIds });
  expect(activate).toHaveBeenCalledWith({ botId: "reviewer", agentId: "existing" });
});

it("opens a stable local draft when no remaining chat has a usable bot", () => {
  const activate = vi.fn();
  renderHook(() =>
    BotWorkspaceBridge({ botId: "removed", localBotIds: ["reviewer"], onActivate: activate }),
  );
  expect(activate).toHaveBeenCalledWith({ botId: "reviewer", agentId: "existing" });
  activate.mockClear();
  renderHook(() =>
    BotWorkspaceBridge({ botId: "removed", localBotIds: ["new-local-bot"], onActivate: activate }),
  );
  expect(activate).toHaveBeenCalledWith({
    botId: "new-local-bot",
    draftId: "paseo-bots:new-local-bot:workspace",
  });
});

it("keeps Live Design restoration, selection and drafts separate in the shared runtime", () => {
  fake.agents.set("design", {
    id: "design",
    cwd: "/worktree",
    createdAt: new Date("2026-04-01"),
    labels: { "paseo-bots.bot": "reviewer", "paseo-bots.context": "live-design" },
  });
  const workspaceActivate = vi.fn();
  const workspace = renderHook(() =>
    BotWorkspaceBridge({ localBotIds, botId: "reviewer", onActivate: workspaceActivate }),
  );
  expect(workspaceActivate).toHaveBeenLastCalledWith({
    botId: "vibing-general",
    agentId: "legacy",
  });
  workspaceActivate.mockClear();
  fake.activate!("design");
  expect(workspaceActivate).not.toHaveBeenCalled();
  workspace.unmount();

  fake.liveDesign = true;
  const designActivate = vi.fn();
  const design = renderHook(() =>
    BotWorkspaceBridge({ localBotIds, botId: "reviewer", onActivate: designActivate }),
  );
  expect(designActivate).toHaveBeenLastCalledWith({ botId: "reviewer", agentId: "design" });
  designActivate.mockClear();
  fake.activate!("existing");
  expect(designActivate).not.toHaveBeenCalled();
  expect(fake.activate!(undefined, true)).toMatch(/^paseo-bots-live-design:reviewer:workspace:/);
  design.unmount();
  fake.agents.delete("design");
});

it("does not restore the workspace's unsent draft into Live Design", () => {
  localStorage.setItem(
    "vibing:paseo-bots:last-draft:/worktree",
    JSON.stringify({ botId: "reviewer", draftId: "paseo-bots:reviewer:workspace" }),
  );
  fake.liveDesign = true;
  const activate = vi.fn();
  renderHook(() => BotWorkspaceBridge({ localBotIds, botId: "reviewer", onActivate: activate }));
  expect(activate).toHaveBeenLastCalledWith({
    botId: "reviewer",
    draftId: "paseo-bots-live-design:reviewer:workspace",
  });
  expect(localStorage.getItem("vibing:paseo-bots:last-draft:/worktree")).toContain(
    "paseo-bots:reviewer:workspace",
  );
});
