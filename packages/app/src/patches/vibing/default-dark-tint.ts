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

const VIBING_LIGHT_TINT: LightThemeConfig = {
  surface0: "#d6d8df",
  surface1: "#cbd1df",
  surface2: "#e6e7ed",
  surface3: "#cbd1df",
  surface4: "#686a77",
  surfaceDiffEmpty: "#cbd1df",
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
  // The upstream light destructive (#b04138) is 4.03:1 on the canvas and 3.75:1 on the hover tone;
  // this is the least darkening that reaches 4.5:1 on canvas, raised and hover.
  destructive: "#9b3931",
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
