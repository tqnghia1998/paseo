export function shouldUseEmbeddedLiveDesignMessaging(
  isEmbeddedFocusMode: boolean,
  search: string,
): boolean {
  return isEmbeddedFocusMode && new URLSearchParams(search).get("embedded-live-design") === "1";
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
  return enabled ? `${route}${route.includes("?") ? "&" : "?"}embedded-live-design=1` : route;
}

export function selectEmbeddedFocusMode<T>(embedded: T, standard: T): T {
  return isEmbeddedFocusMode ? embedded : standard;
}

// Bots owns conversation navigation. Keep only global appearance/settings and chat actions.
export function isEmbeddedShortcutAllowed(action: string): boolean {
  return (
    !isEmbeddedFocusMode ||
    [
      "theme.cycle",
      "settings.toggle",
      "command-center.toggle",
      "command-center.files",
      "shortcuts.dialog.toggle",
      "message-input.action",
      "agent.interrupt",
    ].includes(action)
  );
}
