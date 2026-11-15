import type { DarkThemeConfig, LightThemeConfig } from "@/styles/theme";
import { isEmbeddedFocusMode } from "./focus-mode";
import { VIBING_PALETTES, type VibingPrimitives } from "./palette";

// Space App Vibing tints, derived from the 13-colour palette (./palette.ts) and equal to the
// plugins/space-app-vibing-theme colours (built the way the plugin theme builders in plugins/themes build them;
// surface3 is the plugin's `raisedStrong`). Embedded frames paint the splash and first render before the plugin
// catalog loads, so the built-in dark and light themes must already match the host's mode (`themeMode` query, see
// host-theme-mode.ts). Light and dark use one role mapping; only the palette differs. Upstream's destructive colour
// is kept (the light builder darkens it for readability, see light-readable.ts).
function vibingTint(p: VibingPrimitives) {
  return {
    surface0: p.canvas,
    surface1: p.hover,
    surface2: p.raised,
    surface3: p.hover,
    surface4: p.faint,
    surfaceSidebar: p.canvas,
    surfaceSidebarHover: p.hover,
    surfaceSidebarSelected: p.raised,
    popover: p.raised,
    selected: p.selected,
    foreground: p.text,
    foregroundMuted: p.subdued,
    foregroundExtraMuted: p.faint,
    border: p.border,
    borderAccent: p.border,
    accent: p.blue,
    accentBright: p.blue,
    accentForeground: p.canvas,
    terminalBrightBlack: p.faint,
    ring: p.faint,
  };
}

const VIBING_DARK_TINT: Omit<DarkThemeConfig, "destructive"> = {
  ...vibingTint(VIBING_PALETTES.dark),
  terminalBlack: VIBING_PALETTES.dark.raised,
};

// Light adds the fields only its builder asks for (primary and its foreground, the same roles dark's builder
// derives from `foreground` and `surface0`). ANSI black is the one documented exception to "same role in both modes": dark
// uses the raised card, light the default text, because black is the terminal's darkest colour and a raised card would
// be unreadable on a light canvas (tested in default-dark-tint.test.ts; upstream's own plugin builders differ the same way).
const VIBING_LIGHT_TINT: Omit<LightThemeConfig, "destructive"> = {
  ...vibingTint(VIBING_PALETTES.light),
  primary: VIBING_PALETTES.light.text,
  primaryForeground: VIBING_PALETTES.light.canvas,
  terminalBlack: VIBING_PALETTES.light.text,
};

export function resolveDefaultDarkTint(upstream: DarkThemeConfig): DarkThemeConfig {
  return isEmbeddedFocusMode
    ? { ...VIBING_DARK_TINT, destructive: upstream.destructive }
    : upstream;
}

export function resolveDefaultLightTint(upstream: LightThemeConfig): LightThemeConfig {
  return isEmbeddedFocusMode
    ? { ...VIBING_LIGHT_TINT, destructive: upstream.destructive }
    : upstream;
}

export interface LightRoleColors {
  surfaceSidebarHover: string;
  surfaceSidebarSelected: string;
  surfaceWorkspace: string;
  destructiveForeground: string;
  successForeground: string;
}

/**
 * The roles upstream's light builder maps differently from its dark builder (the sidebar hover and selected fills, the
 * workspace screen and the text on success/destructive fills). Embedded frames map them exactly as dark does, so light
 * differs from dark only in the palette's values.
 */
export function resolveLightRoles(
  tint: LightThemeConfig,
  upstream: LightRoleColors,
): LightRoleColors {
  if (!isEmbeddedFocusMode) return upstream;
  return {
    surfaceSidebarHover: tint.surface1,
    surfaceSidebarSelected: tint.surface2,
    surfaceWorkspace: tint.surface1,
    destructiveForeground: "#ffffff",
    successForeground: "#ffffff",
  };
}
