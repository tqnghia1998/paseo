import { useEffect, useLayoutEffect, useRef } from "react";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";

export const EMBEDDED_FOCUS_BUILD_MARKER = "space-app-vibing-embedded-focus";

export function shouldUseEmbeddedFocusMode(isEmbeddedBuild: boolean): boolean {
  return isEmbeddedBuild && EMBEDDED_FOCUS_BUILD_MARKER.length > 0;
}

export function shouldUseEmbeddedLiveDesignPresentation(
  isEmbeddedFocusMode: boolean,
  search: string,
): boolean {
  return isEmbeddedFocusMode && new URLSearchParams(search).get("embedded-live-design") === "1";
}

export const isEmbeddedFocusMode = shouldUseEmbeddedFocusMode(
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS === "true",
);

export const isEmbeddedLiveDesignPresentation = shouldUseEmbeddedLiveDesignPresentation(
  isEmbeddedFocusMode,
  typeof window === "undefined" ? "" : window.location.search,
);

export function selectEmbeddedFocusMode<T>(embedded: T, standard: T): T {
  return isEmbeddedFocusMode ? embedded : standard;
}

export function selectEmbeddedLiveDesignPresentation<T>(embedded: T, standard: T): T {
  return isEmbeddedLiveDesignPresentation ? embedded : standard;
}

export function embeddedWorkspaceActionsEnabled(input: {
  routeFocused: boolean;
  serverId: string;
  workspaceId: string;
}): boolean {
  return (
    !isEmbeddedLiveDesignPresentation &&
    input.routeFocused &&
    Boolean(input.serverId && input.workspaceId)
  );
}

export function embeddedImportVisible(routeFocused: boolean, importVisible: boolean): boolean {
  return !isEmbeddedFocusMode && routeFocused && importVisible;
}

export function embeddedModelSelectorManagementEnabled(): boolean {
  return !isEmbeddedFocusMode;
}

const EMBEDDED_PROVIDER_PRIORITY = ["codex", "claude", "opencode", "pi"];

export function resolveEmbeddedModelSelection(
  providers: ProviderSelectorProvider[],
  selectedModel = "",
): { provider: string; modelId: string } | null {
  if (selectedModel.trim()) return null;
  for (const providerId of EMBEDDED_PROVIDER_PRIORITY) {
    const provider = providers.find((entry) => entry.id === providerId);
    if (!provider) continue;
    if (provider.modelSelection.kind === "loading") return null;
    if (provider.modelSelection.kind !== "models") continue;
    const model = provider.modelSelection.rows[0];
    if (model) return { provider: providerId, modelId: model.modelId };
  }
  return null;
}

export function useEmbeddedModelSelection(input: {
  isInitialSelectionPending: boolean;
  providers: ProviderSelectorProvider[];
  selectedModel: string;
  select: (provider: string, modelId: string) => void;
}) {
  const { isInitialSelectionPending, providers, selectedModel, select } = input;
  const completedRef = useRef(false);
  useEffect(() => {
    if (!isEmbeddedFocusMode || isInitialSelectionPending || completedRef.current) return;
    if (selectedModel.trim()) {
      completedRef.current = true;
      return;
    }
    const selection = resolveEmbeddedModelSelection(providers);
    if (!selection) return;
    completedRef.current = true;
    select(selection.provider, selection.modelId);
  }, [isInitialSelectionPending, providers, select, selectedModel]);
}

export function embeddedMessageInputFocusShortcutEnabled(): boolean {
  return !isEmbeddedFocusMode;
}

export function embeddedMessageInputFocusHintVisible(input: {
  isWeb: boolean;
  isInputFocused: boolean;
  hasValue: boolean;
}): boolean {
  return (
    embeddedMessageInputFocusShortcutEnabled() &&
    input.isWeb &&
    !input.isInputFocused &&
    !input.hasValue
  );
}

interface EmbeddedTab {
  tabId: string;
  target: { kind: string };
}

export function getEmbeddedConversationTabs<T extends EmbeddedTab>(tabs: T[]): T[] {
  return tabs.filter((tab) => tab.target.kind === "agent" || tab.target.kind === "draft");
}

export function findEmbeddedConversationTabId(tabs: EmbeddedTab[]): string | undefined {
  return getEmbeddedConversationTabs(tabs)[0]?.tabId;
}

export function useEmbeddedLiveDesignConversation(input: {
  activeKind?: string;
  conversationTabId?: string;
  enabled: boolean;
  focusTab: (workspaceKey: string, tabId: string) => void;
  openDraft: () => unknown;
  workspaceKey: string | null;
}) {
  const { activeKind, conversationTabId, enabled, focusTab, openDraft, workspaceKey } = input;
  const openingDraftRef = useRef(false);
  const openingDraftWorkspaceRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!isEmbeddedLiveDesignPresentation || !enabled || !workspaceKey) return;
    if (openingDraftWorkspaceRef.current !== workspaceKey) {
      openingDraftWorkspaceRef.current = workspaceKey;
      openingDraftRef.current = false;
    }
    if (conversationTabId) {
      openingDraftRef.current = false;
      if (activeKind !== "agent" && activeKind !== "draft") {
        focusTab(workspaceKey, conversationTabId);
      }
      return;
    }
    if (activeKind === "agent" || activeKind === "draft" || openingDraftRef.current) return;
    openingDraftRef.current = true;
    openDraft();
  }, [activeKind, conversationTabId, enabled, focusTab, openDraft, workspaceKey]);
}
