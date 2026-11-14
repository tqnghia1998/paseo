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
  surface0: "#e6e7ed",
  surface1: "#dcdee3",
  surface2: "#e1e2e8",
  surface3: "#dcdee3",
  surface4: "#707280",
  surfaceDiffEmpty: "#dcdee3",
  surfaceSidebar: "#e1e2e8",
  foreground: "#343b59",
  foregroundMuted: "#484c61",
  foregroundExtraMuted: "#707280",
  border: "#c1c2c7",
  borderAccent: "#c1c2c7",
  accent: "#2959aa",
  accentBright: "#2959aa",
  accentForeground: "#ffffff",
  primary: "#343b59",
  primaryForeground: "#ffffff",
  destructive: "#b04138",
  terminalBlack: "#343b58",
  terminalBrightBlack: "#707280",
  ring: "#707280",
};

export function resolveDefaultDarkTint(upstream: DarkThemeConfig): DarkThemeConfig {
  return isEmbeddedFocusMode ? VIBING_DARK_TINT : upstream;
}

export function resolveDefaultLightTint(upstream: LightThemeConfig): LightThemeConfig {
  return isEmbeddedFocusMode ? VIBING_LIGHT_TINT : upstream;
}
