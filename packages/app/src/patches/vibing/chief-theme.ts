import { UnistylesRuntime } from "react-native-unistyles";
import {
  buildDarkSemanticColors,
  buildDarkTheme,
  buildLightSemanticColors,
  buildLightTheme,
  darkTheme,
  lightTheme,
  REGISTERED_THEMES,
  type Theme,
} from "@/styles/theme";
import { isEmbeddedChiefView } from "./focus-mode";
import type { HostThemeMode } from "./host-theme-mode";

/**
 * Chief's frame palettes, one per host mode: the same Space App Vibing colours as the host.
 * Surfaces are built through the same semantic builders as a contributed plugin theme.
 *
 * `background`, `control`, `border`, `mutedForeground`, `accent` and `accentBright` are
 * duplicated in Space App Vibing's `src/components/Chief/ChiefPanel.css` (`--chief-surface`,
 * `--chief-control`, `--chief-border`, `--chief-text-muted`, `--chief-accent` and the resolved
 * hex of `--chief-accent-bright`, a `color-mix` there) for the dark `.chief-root` block and the
 * `[data-theme="light"] .chief-root` block: the host popup draws the header around this frame
 * and the two must be the same colours. Change them together.
 */
export const CHIEF_PALETTES = {
  dark: {
    background: "#24292e",
    control: "#2f363d",
    border: "#2f363d",
    // The theme plugin's `raised`: composer, cards and raised surfaces.
    raised: "#2f363d",
    ring: "#959da5",
    foreground: "#f6f8fa",
    mutedForeground: "#d1d5da",
    // The theme blue, shared with the host; filled buttons use dark text (accentForeground).
    accent: "#79b8ff",
    // Links and highlights: color-mix(in srgb, #79b8ff 85%, white).
    accentBright: "#8dc3ff",
    accentForeground: "#1d2125",
  },
  light: {
    background: "#fafbfc",
    control: "#f6f8fa",
    border: "#f6f8fa",
    raised: "#f6f8fa",
    ring: "#6a737d",
    foreground: "#24292e",
    mutedForeground: "#586069",
    accent: "#0366d6",
    // color-mix(in srgb, #0366d6 85%, black): darker, so accent text keeps its contrast.
    accentBright: "#0357b6",
    accentForeground: "#ffffff",
  },
} as const satisfies Record<HostThemeMode, Record<string, string>>;

/**
 * The accent trio alone, for a light theme chosen in the shared settings while the host sent
 * no mode (standalone use of the Chief view): the light-mode accent, readable on light surfaces.
 */
export const CHIEF_ACCENT_COLORS = {
  accent: CHIEF_PALETTES.light.accent,
  accentBright: CHIEF_PALETTES.light.accentBright,
  accentForeground: CHIEF_PALETTES.light.accentForeground,
} as const;

// Mirrors buildDarkPluginTheme / buildLightPluginTheme (plugins/themes), so the Chief frame draws
// every surface exactly like the normal Paseo frames running the Space App Vibing theme plugin.
export function buildChiefColors(mode: HostThemeMode): Theme["colors"] {
  const palette = CHIEF_PALETTES[mode];
  const shared = {
    surface0: palette.background,
    surface1: palette.raised,
    surface2: palette.control,
    surface3: palette.border,
    surface4: palette.ring,
    surfaceDiffEmpty: palette.raised,
    foreground: palette.foreground,
    foregroundMuted: palette.mutedForeground,
    foregroundExtraMuted: palette.ring,
    border: palette.border,
    borderAccent: palette.border,
    accent: palette.accent,
    accentBright: palette.accentBright,
    accentForeground: palette.accentForeground,
    terminalBrightBlack: palette.ring,
    ring: palette.ring,
  };
  const { colors } =
    mode === "light"
      ? buildLightTheme(
          buildLightSemanticColors({
            ...shared,
            surfaceSidebar: palette.control,
            primary: palette.foreground,
            primaryForeground: palette.background,
            destructive: lightTheme.colors.destructive,
            terminalBlack: palette.foreground,
          }),
        )
      : buildDarkTheme(
          buildDarkSemanticColors({
            ...shared,
            surfaceSidebar: palette.background,
            destructive: darkTheme.colors.destructive,
            terminalBlack: palette.control,
          }),
        );
  // The builders reuse the accent for success; keep success states the shared green.
  return { ...colors, success: colors.statusSuccess } as Theme["colors"];
}

const CHIEF_COLORS_BY_MODE: Record<HostThemeMode, Theme["colors"]> = {
  dark: buildChiefColors("dark"),
  light: buildChiefColors("light"),
};
/** The dark-mode colour set (the default when the host sends no mode). */
export const CHIEF_COLORS = CHIEF_COLORS_BY_MODE.dark;

/**
 * Replace the colour tokens, keeping everything the appearance step set (fonts, sizes,
 * content width, and the syntax palette the user chose).
 */
export function withChiefTheme(theme: Theme, mode: HostThemeMode | null = null): Theme {
  // `Theme` is a union of literal theme shapes that a spread cannot satisfy; the result
  // only swaps colour values (and, for a host mode, the matching colour scheme).
  if (mode === null && theme.colorScheme === "light")
    return {
      ...theme,
      colors: { ...theme.colors, ...CHIEF_ACCENT_COLORS },
    } as Theme;
  const resolved = mode ?? "dark";
  return {
    ...theme,
    colorScheme: resolved,
    colors: { ...CHIEF_COLORS_BY_MODE[resolved], syntax: theme.colors.syntax },
  } as Theme;
}

const ALL_THEME_KEYS = Object.keys(REGISTERED_THEMES) as (keyof typeof REGISTERED_THEMES)[];

/**
 * In memory only. All Paseo frames share one origin, so choosing a theme here would
 * be saved to settings and recolour the Bots frames; this patches the live theme
 * instead. Call it after every theme or appearance update: those replace the stored
 * theme and would otherwise bring the host's colours back.
 */
export function applyChiefTheme(
  mode: HostThemeMode | null,
  enabled: boolean = isEmbeddedChiefView,
): void {
  if (!enabled) return;
  for (const key of ALL_THEME_KEYS)
    UnistylesRuntime.updateTheme(key, (theme) => withChiefTheme(theme, mode));
}
