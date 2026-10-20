/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
  window.history.replaceState(null, "", "/?embedded-live-design=1");
});
import { useEmbeddedWorkspaceConversation } from "./workspace-conversation";

const parent = window.parent;
const referrer = document.referrer;
const origin = "http://localhost:5183";
type ConversationInput = Parameters<typeof useEmbeddedWorkspaceConversation>[0];

function setup(overrides: Partial<ConversationInput> = {}) {
  Object.defineProperty(window, "parent", { configurable: true, value: { postMessage: vi.fn() } });
  Object.defineProperty(document, "referrer", { configurable: true, value: `${origin}/` });
  const input: ConversationInput = {
    enabled: true,
    layoutInitialized: true,
    workspaceId: "workspace",
    persistenceKey: "server:workspace",
    activeTabId: null,
    tabs: [],
    allTabs: [],
    openDraft: vi.fn(() => "new-draft"),
    openTab: vi.fn(() => null),
    focusTab: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(useEmbeddedWorkspaceConversation, { initialProps: input });
  return {
    input,
    hook,
    send(type = "space:paseo-prompt-ready-request", senderOrigin = origin) {
      act(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window.parent,
            origin: senderOrigin,
            data: { type, requestId: "request" },
          }),
        ),
      );
    },
  };
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  Object.defineProperty(document, "referrer", { configurable: true, value: referrer });
  sessionStorage.clear();
});

it("opens one Agent composer automatically for an empty embedded workspace", () => {
  const h = setup();
  expect(h.input.openDraft).toHaveBeenCalledTimes(1);
  h.hook.rerender({ ...h.input });
  expect(h.input.openDraft).toHaveBeenCalledTimes(1);
  h.send();
  expect(h.input.openDraft).toHaveBeenCalledTimes(1);
});

it("waits for native layout initialization before deciding whether another draft is needed", () => {
  const h = setup({ layoutInitialized: false });
  expect(h.input.openDraft).not.toHaveBeenCalled();
  const draft = { tabId: "native-draft", target: { kind: "draft", draftId: "native" } } as const;
  h.hook.rerender({
    ...h.input,
    layoutInitialized: true,
    tabs: [draft],
    allTabs: [draft],
    activeTabId: draft.tabId,
  });
  expect(h.input.openDraft).not.toHaveBeenCalled();
});

it("opens a replacement whenever the final visible conversation closes", () => {
  const h = setup();
  const draft = { tabId: "draft", target: { kind: "draft", draftId: "draft" } } as const;
  h.hook.rerender({ ...h.input, tabs: [draft], allTabs: [draft], activeTabId: draft.tabId });
  h.hook.rerender(h.input);
  expect(h.input.openDraft).toHaveBeenCalledTimes(2);
  h.hook.rerender({ ...h.input, tabs: [draft], allTabs: [draft], activeTabId: draft.tabId });
  h.hook.rerender(h.input);
  expect(h.input.openDraft).toHaveBeenCalledTimes(3);
});

it("focuses the nearest conversation before accepting a host prompt", () => {
  const tabs: ConversationInput["tabs"] = [
    { tabId: "earlier", target: { kind: "agent", agentId: "agent" } },
    { tabId: "terminal", target: { kind: "terminal", terminalId: "terminal" } },
    { tabId: "later", target: { kind: "draft", draftId: "draft" } },
  ];
  const h = setup({ tabs, allTabs: tabs, activeTabId: "terminal" });
  h.send();
  expect(h.input.focusTab).toHaveBeenCalledWith("server:workspace", "earlier");
  expect(h.input.openDraft).not.toHaveBeenCalled();
});

it("opens one draft across repeated readiness requests and resets for a different workspace", () => {
  const h = setup();
  h.send();
  h.send();
  expect(h.input.openDraft).toHaveBeenCalledTimes(1);
  h.hook.rerender({ ...h.input, persistenceKey: "server:other", workspaceId: "other" });
  h.send();
  expect(h.input.openDraft).toHaveBeenCalledTimes(2);
});

it("always creates a fresh draft for an explicit new-agent request", () => {
  const h = setup();
  h.send();
  h.send("space:paseo-live-design-new-agent-request");
  expect(h.input.openDraft).toHaveBeenCalledTimes(2);
});

it("does not activate a conversation for foreign origins or inactive workspaces", () => {
  const h = setup();
  vi.mocked(h.input.openDraft).mockClear();
  h.send("space:paseo-prompt-ready-request", "https://foreign.example");
  h.hook.rerender({ ...h.input, enabled: false });
  h.send();
  expect(h.input.openDraft).not.toHaveBeenCalled();
  expect(h.input.focusTab).not.toHaveBeenCalled();
});

it("projects saved tool tabs out of embedded workspaces without deleting their state", async () => {
  const { normalizeLayout, collectAllTabs, collectAllPanes } =
    await import("@/stores/workspace-layout-actions");
  const { projectEmbeddedAgentLayout, useEmbeddedAgentFocus } = await import("./agent-workspace");
  const layout = normalizeLayout({
    root: {
      kind: "group",
      group: {
        id: "split",
        direction: "horizontal",
        sizes: [0.6, 0.4],
        children: [
          {
            kind: "pane",
            pane: {
              id: "chat",
              focusedTabId: "draft",
              tabs: [
                { tabId: "agent", target: { kind: "agent", agentId: "running" }, createdAt: 1 },
                { tabId: "draft", target: { kind: "draft", draftId: "draft" }, createdAt: 2 },
              ],
            },
          },
          {
            kind: "pane",
            pane: {
              id: "tools",
              focusedTabId: "file",
              tabs: [
                {
                  tabId: "file",
                  target: { kind: "file", path: "/repo/a.ts" },
                  state: { unsaved: "keep me" },
                  createdAt: 3,
                },
                {
                  tabId: "terminal",
                  target: { kind: "terminal", terminalId: "term" },
                  createdAt: 4,
                },
              ],
            },
          },
        ],
      },
    },
    focusedPaneId: "tools",
  });
  const original = JSON.stringify(layout);
  const projected = projectEmbeddedAgentLayout(layout)!;
  expect(collectAllTabs(projected.root).map((tab) => tab.tabId)).toEqual(["agent", "draft"]);
  expect(projected.focusedPaneId).toBe("chat");
  expect(collectAllPanes(projected.root)[0]!.focusedTabId).toBe("draft");
  expect(JSON.stringify(layout)).toBe(original);
  expect(collectAllTabs(layout.root).find((tab) => tab.tabId === "file")?.state).toEqual({
    unsaved: "keep me",
  });
  const focusTab = vi.fn();
  renderHook(useEmbeddedAgentFocus, {
    initialProps: {
      enabled: true,
      workspaceKey: "server:workspace",
      saved: layout,
      visible: projected,
      focusTab,
    },
  });
  expect(focusTab).toHaveBeenCalledWith("server:workspace", "draft");
});

it("does not create drafts for an inactive workspace", () => {
  const h = setup({ enabled: false });
  expect(h.input.openDraft).not.toHaveBeenCalled();
});
