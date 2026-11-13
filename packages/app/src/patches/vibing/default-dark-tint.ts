import type { DarkThemeConfig, LightThemeConfig } from "@/styles/theme";
import { isEmbeddedFocusMode } from "./focus-mode";

// Space App Vibing tints, equal to plugins/space-app-vibing-theme (built the way the plugin theme
// builders in plugins/themes build them). Embedded frames paint the splash and first render before
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
  border: "#2f363d",
  borderAccent: "#2f363d",
  accent: "#79b8ff",
  accentBright: "#79b8ff",
  accentForeground: "#1d2125",
  destructive: "#c64f43",
  terminalBlack: "#24292e",
  terminalBrightBlack: "#959da5",
  ring: "#959da5",
};

const VIBING_LIGHT_TINT: LightThemeConfig = {
  surface0: "#ffffff",
  surface1: "#f6f8fa",
  surface2: "#fafbfc",
  surface3: "#f6f8fa",
  surface4: "#6a737d",
  surfaceDiffEmpty: "#f6f8fa",
  surfaceSidebar: "#fafbfc",
  foreground: "#24292e",
  foregroundMuted: "#586069",
  foregroundExtraMuted: "#6a737d",
  border: "#f6f8fa",
  borderAccent: "#f6f8fa",
  accent: "#0366d6",
  accentBright: "#0366d6",
  accentForeground: "#ffffff",
  primary: "#24292e",
  primaryForeground: "#ffffff",
  destructive: "#b04138",
  terminalBlack: "#24292e",
  terminalBrightBlack: "#6a737d",
  ring: "#6a737d",
};

export function resolveDefaultDarkTint(upstream: DarkThemeConfig): DarkThemeConfig {
  return isEmbeddedFocusMode ? VIBING_DARK_TINT : upstream;
}

export function resolveDefaultLightTint(upstream: LightThemeConfig): LightThemeConfig {
  return isEmbeddedFocusMode ? VIBING_LIGHT_TINT : upstream;
}
