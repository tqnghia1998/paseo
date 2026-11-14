import type { PluginClientContext } from "@getpaseo/plugin/client";

// Values come from the host palette in Space App Vibing (docs/theme.md, Desktop Plus colours).
// Keep them equal to --palette-neutral-* and --palette-blue in src/index.css for each mode:
// background = neutral-850 surface, raised = neutral-750 hover tone, border = --palette-border
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
      background: "#ffffff",
      foreground: "#24292e",
      raised: "#f6f8fa",
      control: "#fafbfc",
      border: "#e1e4e8",
      accent: "#0366d6",
      mutedForeground: "#586069",
      ring: "#6a737d",
    },
  });
  return async () => {
    await removeLight();
    await removeDark();
  };
}
