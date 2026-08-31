import { useLayoutEffect } from "react";

export const EMBEDDED_CHAT_ONLY_BUILD_MARKER = "space-app-vibing-chat-only";

export const isEmbeddedChatOnly =
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_CHAT_ONLY === "true" &&
  EMBEDDED_CHAT_ONLY_BUILD_MARKER.length > 0;

export function selectEmbeddedChatOnly<T>(embedded: T, standard: T): T {
  return isEmbeddedChatOnly ? embedded : standard;
}

export function embeddedWorkspaceActionsEnabled(input: {
  routeFocused: boolean;
  serverId: string;
  workspaceId: string;
}): boolean {
  return !isEmbeddedChatOnly && input.routeFocused && Boolean(input.serverId && input.workspaceId);
}

export function embeddedImportVisible(routeFocused: boolean, importVisible: boolean): boolean {
  return !isEmbeddedChatOnly && routeFocused && importVisible;
}

export function findEmbeddedConversationTabId(
  tabs: Array<{ tabId: string; target: { kind: string } }>,
): string | undefined {
  return tabs.find((tab) => tab.target.kind === "agent" || tab.target.kind === "draft")?.tabId;
}

export function useEmbeddedChatOnlyConversation(input: {
  activeKind?: string;
  conversationTabId?: string;
  enabled: boolean;
  focusTab: (workspaceKey: string, tabId: string) => void;
  openDraft: () => unknown;
  workspaceKey: string | null;
}) {
  const { activeKind, conversationTabId, enabled, focusTab, openDraft, workspaceKey } = input;
  useLayoutEffect(() => {
    if (!isEmbeddedChatOnly || !enabled || activeKind === "agent" || activeKind === "draft") return;
    if (conversationTabId && workspaceKey) focusTab(workspaceKey, conversationTabId);
    else openDraft();
  }, [activeKind, conversationTabId, enabled, focusTab, openDraft, workspaceKey]);
}
