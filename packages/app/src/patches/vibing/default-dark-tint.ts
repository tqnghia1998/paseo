import type { DarkThemeConfig } from "@/styles/theme";
import { isEmbeddedFocusMode } from "./focus-mode";

// Space App Vibing tint, equal to plugins/space-app-vibing-theme. Embedded frames paint the splash
// and first render before the plugin catalog loads, so the built-in dark theme must already match.
const VIBING_DARK_TINT: DarkThemeConfig = {
  surface0: "#181a1f",
  surface1: "#21242b",
  surface2: "#1c2025",
  surface3: "#21242b",
  surface4: "#7f848e",
  surfaceDiffEmpty: "#21242b",
  surfaceSidebar: "#181a1f",
  foreground: "#abb2bf",
  foregroundMuted: "#9da5b4",
  foregroundExtraMuted: "#7f848e",
  border: "#21242b",
  borderAccent: "#21242b",
  accent: "#61afef",
  accentBright: "#61afef",
  accentForeground: "#181a1f",
  destructive: "#c64f43",
  terminalBlack: "#1c2025",
  terminalBrightBlack: "#7f848e",
  ring: "#7f848e",
};

export function resolveDefaultDarkTint(upstream: DarkThemeConfig): DarkThemeConfig {
  return isEmbeddedFocusMode ? VIBING_DARK_TINT : upstream;
}
