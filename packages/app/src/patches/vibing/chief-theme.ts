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
import { pluginThemeColors, VIBING_PALETTES, type VibingPrimitives } from "./palette";

// Mixes a colour toward another one (`amount` of `toward`), channel by channel, as CSS color-mix does.
function mixHex(base: string, toward: string, amount: number): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const target = channels(toward);
  return `#${channels(base)
    .map((value, index) =>
      Math.round(value + (target[index]! - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// One mapping for both modes, from the same 13-colour palette as the theme plugin (Chief's `background` is the
// plugin's `control`, the raised card; its `control` and `raised` are the plugin's `raised`, the hover tone).
function chiefPalette(p: VibingPrimitives) {
  const plugin = pluginThemeColors(p);
  return {
    background: plugin.control,
    control: plugin.raised,
    border: plugin.border,
    // The theme plugin's `raised`: composer, cards and raised surfaces.
    raised: plugin.raised,
    // The theme plugin's `raisedStrong` (surface3): secondary fills and the sidebar hover stay on the hover tone while
    // borders use their own value.
    raisedStrong: plugin.raisedStrong,
    // The selected-row tone, handed to plugins as `selected` (the Bots selected pill).
    selected: plugin.selected,
    ring: plugin.ring,
    foreground: plugin.foreground,
    mutedForeground: plugin.mutedForeground,
    accent: plugin.accent,
    // Links and highlights: the accent mixed 17% toward the default text, the same expression in both modes (CSS:
    // color-mix(in srgb, <accent> 83%, <text>)). Toward the text rather than toward white, so it lightens in dark
    // and darkens in light and keeps its contrast on the Chief surfaces in both.
    accentBright: mixHex(plugin.accent, plugin.foreground, 0.17),
    // Filled buttons use the canvas as their text colour, as the theme plugin's builders do (accentForeground).
    accentForeground: plugin.background,
  };
}

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
  dark: chiefPalette(VIBING_PALETTES.dark),
  light: chiefPalette(VIBING_PALETTES.light),
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
    surface3: palette.raisedStrong,
    surface4: palette.ring,
    surfaceDiffEmpty: palette.raised,
    selected: palette.selected,
    // The Chief surface in both modes, never the control tone.
    surfaceSidebar: palette.background,
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
            // Tooltips and hover cards sit one step off the Chief surface (dark: surface2, the control tone).
            popover: palette.control,
            primary: palette.foreground,
            primaryForeground: palette.background,
            destructive: lightTheme.colors.destructive,
            terminalBlack: palette.foreground,
          }),
        )
      : buildDarkTheme(
          buildDarkSemanticColors({
            ...shared,
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
