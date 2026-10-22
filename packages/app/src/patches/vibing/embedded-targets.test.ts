import { afterEach, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("./focus-mode", () => ({ isEmbeddedFocusMode: true }));

import {
  getEmbeddedActiveChat,
  getEmbeddedChatTab,
  openEmbeddedTarget,
  registerEmbeddedTargetOpener,
} from "./embedded-targets";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
function register(open: (target: unknown) => boolean, agentId: string | null = null) {
  const unregister = registerEmbeddedTargetOpener({ open, serverId: "host", agentId });
  cleanups.push(unregister);
  return unregister;
}

it("routes targets to the most recently activated Bots chat", () => {
  const first = vi.fn(() => true);
  const second = vi.fn(() => true);
  register(first, "chat-1");
  const unregisterSecond = register(second, "chat-2");

  expect(openEmbeddedTarget({ kind: "changes_tree" })).toBe(true);
  expect(second).toHaveBeenCalledWith({ kind: "changes_tree" });
  expect(first).not.toHaveBeenCalled();
  expect(getEmbeddedActiveChat()).toEqual({ serverId: "host", agentId: "chat-2" });

  unregisterSecond();
  expect(openEmbeddedTarget({ kind: "files" })).toBe(true);
  expect(first).toHaveBeenCalledWith({ kind: "files" });
  expect(getEmbeddedActiveChat()).toEqual({ serverId: "host", agentId: "chat-1" });
});

it("reports targets the active chat cannot show and does nothing without a chat", () => {
  expect(openEmbeddedTarget({ kind: "files" })).toBe(false);
  expect(getEmbeddedActiveChat()).toBeNull();
  register(() => false);
  expect(openEmbeddedTarget({ kind: "terminal", terminalId: "t" })).toBe(false);
});

it("offers the visible chat as the agent tab upstream code looks for", () => {
  expect(getEmbeddedChatTab()).toBeNull();
  register(() => true, "chat-1");
  expect(getEmbeddedChatTab()).toEqual({
    key: "bots:chat-1",
    tabId: "bots:chat-1",
    kind: "agent",
    target: { kind: "agent", agentId: "chat-1" },
  });
});
