import type { DarkThemeConfig, LightThemeConfig } from "@/styles/theme";
import { isEmbeddedFocusMode } from "./focus-mode";

// Space App Vibing tints, equal to plugins/space-app-vibing-theme (built the way the plugin theme
// builders in plugins/themes build them; surface3 is the plugin's `raisedStrong`). Embedded frames paint the splash and first render before
// the plugin catalog loads, so the built-in dark and light themes must already match the host's
// mode (`themeMode` query, see host-theme-mode.ts).
const VIBING_DARK_TINT: DarkThemeConfig = {
  surface0: "#1d2125",
  surface1: "#2f363d",
  surface2: "#24292e",
  surface3: "#2f363d",
  surface4: "#959da5",
  surfaceDiffEmpty: "#2f363d",
  surfaceSidebar: "#1d2125",
  popover: "#24292e",
  foreground: "#f6f8fa",
  foregroundMuted: "#d1d5da",
  foregroundExtraMuted: "#959da5",
  border: "#2b3137",
  borderAccent: "#2b3137",
  accent: "#79b8ff",
  accentBright: "#79b8ff",
  accentForeground: "#1d2125",
  destructive: "#c64f43",
  terminalBlack: "#24292e",
  terminalBrightBlack: "#959da5",
  ring: "#959da5",
};

// Light surface1 and surface3 (the theme plugin's `raised` and `raisedStrong`: composer, user bubbles,
// badges, secondary fills) are the neutral grey #cbcdd3, the 50/50 mix of the canvas #d6d8df and the
// border #c1c2c7. It is not a palette primitive: the host's hover tone stays #cbd1df, which reads blue.
const VIBING_LIGHT_TINT: LightThemeConfig = {
  surface0: "#d6d8df",
  surface1: "#cbcdd3",
  surface2: "#e6e7ed",
  surface3: "#cbcdd3",
  surface4: "#686a77",
  surfaceDiffEmpty: "#cbcdd3",
  // The canvas, as in dark: the sidebar, tab strip and settings navigation are never the raised control tone.
  surfaceSidebar: "#d6d8df",
  // Tooltips and hover cards are the raised card in both modes.
  popover: "#e6e7ed",
  foreground: "#343b59",
  foregroundMuted: "#4c505e",
  foregroundExtraMuted: "#686a77",
  border: "#c1c2c7",
  borderAccent: "#c1c2c7",
  accent: "#395d99",
  accentBright: "#395d99",
  accentForeground: "#ffffff",
  primary: "#343b59",
  primaryForeground: "#ffffff",
  // The upstream light destructive (#b04138) is 4.03:1 on the canvas and 3.6:1 on the neutral raised
  // tone; this is the least darkening that reaches 4.5:1 on canvas, raised (#e6e7ed) and that tone.
  destructive: "#973830",
  terminalBlack: "#343b58",
  terminalBrightBlack: "#686a77",
  ring: "#686a77",
};

export function resolveDefaultDarkTint(upstream: DarkThemeConfig): DarkThemeConfig {
  return isEmbeddedFocusMode ? VIBING_DARK_TINT : upstream;
}

export function resolveDefaultLightTint(upstream: LightThemeConfig): LightThemeConfig {
  return isEmbeddedFocusMode ? VIBING_LIGHT_TINT : upstream;
}
