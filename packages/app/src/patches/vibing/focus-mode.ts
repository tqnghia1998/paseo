export function shouldUseEmbeddedLiveDesignMessaging(
  isEmbeddedFocusMode: boolean,
  search: string,
): boolean {
  return isEmbeddedFocusMode && new URLSearchParams(search).get("embedded-live-design") === "1";
}

export function shouldUseDesktopWorkspaceTabs(
  isCompact: boolean,
  isLiveDesignMessaging: boolean,
): boolean {
  return !isCompact || isLiveDesignMessaging;
}

export const isEmbeddedFocusMode = process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS === "true";

function embeddedMessagingSearch(): string {
  if (!isEmbeddedFocusMode || typeof window === "undefined") return "";
  if (typeof window.name === "string" && window.name.startsWith("paseo-workspace:live-design:"))
    return "?embedded-live-design=1";
  return window.location.search;
}

export const isEmbeddedLiveDesignMessaging = shouldUseEmbeddedLiveDesignMessaging(
  isEmbeddedFocusMode,
  embeddedMessagingSearch(),
);

export function preserveEmbeddedLiveDesignMessagingQuery(route: string, enabled: boolean): string {
  return enabled ? `${route}?embedded-live-design=1` : route;
}

export function selectEmbeddedFocusMode<T>(embedded: T, standard: T): T {
  return isEmbeddedFocusMode ? embedded : standard;
}

export function workspaceNewTabTarget(draftId: string) {
  return isEmbeddedFocusMode
    ? ({ kind: "draft", draftId } as const)
    : ({ kind: "new_tab" } as const);
}

interface EmbeddedTab {
  tabId: string;
  target: { kind: string };
}

const isConversationTab = (tab: EmbeddedTab) =>
  tab.target.kind === "agent" ||
  tab.target.kind === "draft" ||
  tab.target.kind === "provider_subagent";

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

// The historical build flag identifies embedding, not the user's Focus Mode preference.
export function migrateEmbeddedPanelFocus<T extends { desktop?: { focusModeEnabled?: boolean } }>(
  state: T,
  version: number,
): T {
  if (!isEmbeddedFocusMode || version >= 17 || !state.desktop) return state;
  return { ...state, desktop: { ...state.desktop, focusModeEnabled: false } };
}

// Filter before shortcut resolution so host/global bindings are not consumed by the iframe.
export function isEmbeddedShortcutAllowed(action: string): boolean {
  return (
    !isEmbeddedFocusMode ||
    action.startsWith("workspace.tab.") ||
    action.startsWith("workspace.pane.") ||
    [
      "command-center.toggle",
      "theme.cycle",
      "settings.toggle",
      "shortcuts.dialog.toggle",
      "workspace.pin",
      "sidebar.toggle.left",
      "view.toggle.focus",
      "message-input.action",
      "agent.interrupt",
    ].includes(action)
  );
}
