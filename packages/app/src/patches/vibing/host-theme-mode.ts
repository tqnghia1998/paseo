import { useEffect, useState } from "react";
import { isEmbeddedFocusMode } from "./focus-mode";
import { getEmbeddedHostOrigin, subscribeToHostMessages } from "./host-messages";

/**
 * Space App Vibing's resolved light/dark mode, pushed to every embedded frame: at load
 * through the `themeMode` query and live through `{ type: "space:theme-mode", mode }`
 * from the embedding parent (the Vibing window, or the previewed page for Live Design).
 * The frame applies it in memory only (`resolveEmbeddedThemeInput` in `theme.ts`).
 */
export type HostThemeMode = "light" | "dark";

export const HOST_THEME_MODE_MESSAGE = "space:theme-mode";
export const HOST_THEME_MODE_QUERY = "themeMode";

function asMode(value: unknown): HostThemeMode | null {
  return value === "light" || value === "dark" ? value : null;
}

/** The `themeMode` query value of `search`, or null for anything but `light`/`dark`. */
export function parseHostThemeMode(search: string): HostThemeMode | null {
  try {
    return asMode(new URLSearchParams(search).get(HOST_THEME_MODE_QUERY));
  } catch {
    return null;
  }
}

/** The mode of an exact `{ type: "space:theme-mode", mode }` message, else null. */
export function parseHostThemeModeMessage(data: unknown): HostThemeMode | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const message = data as { type?: unknown; mode?: unknown };
  return message.type === HOST_THEME_MODE_MESSAGE ? asMode(message.mode) : null;
}

/** The mode the host put in this frame's URL; null outside embedded frames. */
export function getHostThemeMode(): HostThemeMode | null {
  if (!isEmbeddedFocusMode || typeof window === "undefined") return null;
  return parseHostThemeMode(window.location.search);
}

/**
 * Starts from the URL synchronously, so the first paint already has the host's mode, then
 * follows the host's messages (parent window and origin only, exact shape only).
 */
export function useHostThemeMode(): HostThemeMode | null {
  const [mode, setMode] = useState<HostThemeMode | null>(getHostThemeMode);
  useEffect(() => {
    if (!isEmbeddedFocusMode) return;
    const origin = getEmbeddedHostOrigin();
    if (!origin) return;
    return subscribeToHostMessages(origin, (data) => {
      const next = parseHostThemeModeMessage(data);
      if (next) setMode(next);
    });
  }, []);
  return mode;
}
