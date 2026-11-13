import type { PluginClientContext } from "@getpaseo/plugin/client";

export default function contribute(client: PluginClientContext) {
  const removeTheme = client.addTheme({
    id: "dark",
    name: "Space App Vibing",
    appearance: "dark",
    // Values come from the host palette in Space App Vibing (docs/theme.md): base, hover tone,
    // raised and subtle border. Keep them equal to --palette-neutral-* in src/index.css.
    colors: {
      background: "#181a1f",
      foreground: "#abb2bf",
      raised: "#21242b",
      control: "#1c2025",
      border: "#21242b",
      accent: "#61afef",
      mutedForeground: "#9da5b4",
      // Paseo also uses ring for placeholders, muted controls and terminal bright black.
      ring: "#7f848e",
    },
  });
  return removeTheme;
}
