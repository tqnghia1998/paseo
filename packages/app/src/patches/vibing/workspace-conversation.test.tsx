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
  h.send("space:paseo-prompt-ready-request", "https://foreign.example");
  h.hook.rerender({ ...h.input, enabled: false });
  h.send();
  expect(h.input.openDraft).not.toHaveBeenCalled();
  expect(h.input.focusTab).not.toHaveBeenCalled();
});
