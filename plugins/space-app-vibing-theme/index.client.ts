import type { PluginClientContext } from "@getpaseo/plugin/client";

// Values come from the host palette in Space App Vibing (docs/theme.md: dark is Desktop Plus, light follows the SeaTalk light theme arrangement of Tokyo Night Light tones).
// Keep them equal to --palette-neutral-* and --palette-blue in src/index.css for each mode:
// background = neutral-850 surface, raised and raisedStrong = neutral-750 hover tone (raisedStrong
// keeps Paseo's secondary fills and light sidebar hover on the hover tone), border = --palette-border
// (its own value, never the hover tone), control = neutral-800 raised, accent = blue, foreground = neutral-200 text,
// mutedForeground = neutral-300 subdued text, ring = neutral-400 faint text (Paseo also uses
// ring for placeholders, muted controls and terminal bright black).
// Embedded frames pick the theme of the host's mode in memory; see patches/vibing/theme.ts.
export default function contribute(client: PluginClientContext) {
  const removeDark = client.addTheme({
    id: "dark",
    name: "Space App Vibing",
    appearance: "dark",
    colors: {
      background: "#1d2125",
      foreground: "#f6f8fa",
      raised: "#2f363d",
      control: "#24292e",
      border: "#2b3137",
      raisedStrong: "#2f363d",
      accent: "#79b8ff",
      mutedForeground: "#d1d5da",
      ring: "#959da5",
    },
  });
  const removeLight = client.addTheme({
    id: "light",
    name: "Space App Vibing Light",
    appearance: "light",
    colors: {
      background: "#d6d8df",
      foreground: "#343b59",
      raised: "#cbd1df",
      control: "#e6e7ed",
      border: "#c1c2c7",
      raisedStrong: "#cbd1df",
      accent: "#395d99",
      mutedForeground: "#4c505e",
      ring: "#686a77",
    },
  });
  return async () => {
    await removeLight();
    await removeDark();
  };
}
