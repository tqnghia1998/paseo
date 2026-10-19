import type { PluginClientContext } from "@getpaseo/plugin/client";

export default function contribute(client: PluginClientContext) {
  return client.addTheme({
    id: "dark",
    name: "Space App Vibing",
    appearance: "dark",
    colors: {
      background: "#1a1a1a",
      foreground: "#ffffff",
      raised: "#1a1a1a",
      control: "#252526",
      border: "#222225",
      accent: "#3a96dd",
      mutedForeground: "#a0a0a0",
      // Paseo also uses ring for placeholders, muted controls and terminal bright black.
      ring: "#6e6e6e",
    },
  });
}
