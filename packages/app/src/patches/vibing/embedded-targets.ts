import { useMemo, useSyncExternalStore } from "react";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { isEmbeddedFocusMode } from "./focus-mode";

// The embedded build mounts no workspace screen, so tabs, sheets and the Explorer opened by
// upstream code would never appear. The active Bots chat shows those targets instead.
export interface EmbeddedTargetOpener {
  serverId: string;
  /** The chat on screen, so chat-scoped commands act on it. */
  agentId: string | null;
  /** Shows the target in the chat; false when Bots cannot show that kind. */
  open(target: WorkspaceTabTarget): boolean;
}

const openers: EmbeddedTargetOpener[] = [];
const listeners = new Set<() => void>();
let activeChat: { serverId: string; agentId: string | null } | null = null;

function publish(): void {
  const top = openers.at(-1);
  const next = top ? { serverId: top.serverId, agentId: top.agentId } : null;
  if (next?.serverId === activeChat?.serverId && next?.agentId === activeChat?.agentId) return;
  activeChat = next;
  for (const listener of listeners) listener();
}

/** Registers the visible Bots chat; the most recent registration receives targets. */
export function registerEmbeddedTargetOpener(opener: EmbeddedTargetOpener): () => void {
  openers.push(opener);
  publish();
  return () => {
    const index = openers.lastIndexOf(opener);
    if (index >= 0) openers.splice(index, 1);
    publish();
  };
}

/** Shows a workspace target in the active Bots chat. False outside Bots or for unsupported kinds. */
export function openEmbeddedTarget(target: WorkspaceTabTarget): boolean {
  if (!isEmbeddedFocusMode) return false;
  return openers.at(-1)?.open(target) ?? false;
}

export function getEmbeddedActiveChat(): { serverId: string; agentId: string | null } | null {
  return activeChat;
}

export function useEmbeddedActiveChat(): { serverId: string; agentId: string | null } | null {
  return useSyncExternalStore(subscribe, getEmbeddedActiveChat, getEmbeddedActiveChat);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The visible Bots chat as an agent tab, for upstream code that looks for one, like review feedback. */
export function getEmbeddedChatTab(): {
  key: string;
  tabId: string;
  kind: "agent";
  target: { kind: "agent"; agentId: string };
} | null {
  const agentId = isEmbeddedFocusMode ? activeChat?.agentId : null;
  if (!agentId) return null;
  return {
    key: `bots:${agentId}`,
    tabId: `bots:${agentId}`,
    kind: "agent",
    target: { kind: "agent", agentId },
  };
}

/** The visible Bots chat's composer, for "Add to chat" from Files, Changes and diffs. */
export function useEmbeddedChatTarget(
  serverId: string,
): { tabId: string; draftKey: string; agentId: string } | null {
  const chat = useEmbeddedActiveChat();
  return useMemo(() => {
    const agentId = isEmbeddedFocusMode && chat?.serverId === serverId ? chat.agentId : null;
    if (!agentId) return null;
    return {
      tabId: `bots:${agentId}`,
      draftKey: buildDraftStoreKey({ serverId, agentId }),
      agentId,
    };
  }, [chat, serverId]);
}
