import { useEffect, useRef } from "react";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";

export const EMBEDDED_FOCUS_BUILD_MARKER = "space-app-vibing-embedded-focus";

export function shouldUseEmbeddedFocusMode(isEmbeddedBuild: boolean): boolean {
  return isEmbeddedBuild && EMBEDDED_FOCUS_BUILD_MARKER.length > 0;
}

export function shouldUseEmbeddedLiveDesignMessaging(
  isEmbeddedFocusMode: boolean,
  search: string,
): boolean {
  return isEmbeddedFocusMode && new URLSearchParams(search).get("embedded-live-design") === "1";
}

export const isEmbeddedFocusMode = shouldUseEmbeddedFocusMode(
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS === "true",
);

export const isEmbeddedLiveDesignMessaging = shouldUseEmbeddedLiveDesignMessaging(
  isEmbeddedFocusMode,
  typeof window === "undefined" ? "" : window.location.search,
);

export function preserveEmbeddedLiveDesignMessagingQuery(route: string, enabled: boolean): string {
  return enabled ? `${route}?embedded-live-design=1` : route;
}

export function selectEmbeddedFocusMode<T>(embedded: T, standard: T): T {
  return isEmbeddedFocusMode ? embedded : standard;
}

export function embeddedWorkspaceActionsEnabled(input: {
  routeFocused: boolean;
  serverId: string;
  workspaceId: string;
}): boolean {
  return input.routeFocused && Boolean(input.serverId && input.workspaceId);
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

const isConversationTab = (tab: EmbeddedTab) =>
  tab.target.kind === "agent" || tab.target.kind === "draft";

export function findNearestEmbeddedConversationTabId(
  tabs: EmbeddedTab[],
  activeTabId: string | null,
): string | undefined {
  const activeIndex = tabs.findIndex((tab) => tab.tabId === activeTabId);
  if (activeIndex < 0) return tabs.find(isConversationTab)?.tabId;

  let nearest: { distance: number; tabId: string } | undefined;
  tabs.forEach((tab, index) => {
    if (!isConversationTab(tab)) return;
    const distance = Math.abs(index - activeIndex);
    if (!nearest || distance < nearest.distance) nearest = { distance, tabId: tab.tabId };
  });
  return nearest?.tabId;
}
