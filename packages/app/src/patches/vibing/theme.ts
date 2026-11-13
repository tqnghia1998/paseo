import type { PluginThemeOption } from "@/plugins/themes";
import { PLUGIN_THEME_PREFERENCE, type ThemePreference } from "@/styles/theme";
import { isEmbeddedFocusMode } from "./focus-mode";
import type { HostThemeMode } from "./host-theme-mode";

/** The two palettes of the bundled `space-app-vibing-theme` plugin, one per host mode. */
export const VIBING_THEME_IDS: Record<HostThemeMode, string> = {
  dark: "space-app-vibing-theme/theme/dark",
  light: "space-app-vibing-theme/theme/light",
};

export interface EmbeddedThemeInput {
  preference: ThemePreference;
  contributedTheme: PluginThemeOption | null;
}

/**
 * The theme an embedded frame shows: the Space App Vibing theme of the host's mode (dark when
 * the host sent none), or the matching built-in theme until the plugin catalog has loaded.
 *
 * In memory only. Every Paseo frame shares one origin and one settings store, so a choice
 * saved here would recolour sibling frames and standalone Paseo. Outside embedded frames the
 * saved appearance is returned unchanged.
 */
export function resolveEmbeddedThemeInput(
  saved: EmbeddedThemeInput,
  options: readonly PluginThemeOption[],
  mode: HostThemeMode | null,
): EmbeddedThemeInput {
  if (!isEmbeddedFocusMode) return saved;
  const resolved = mode ?? "dark";
  const theme = options.find((option) => option.id === VIBING_THEME_IDS[resolved]);
  return theme
    ? { preference: PLUGIN_THEME_PREFERENCE, contributedTheme: theme }
    : { preference: resolved, contributedTheme: null };
}
