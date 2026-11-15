import type { PluginClientContext } from "@getpaseo/plugin/client";

// The Space App Vibing palette (docs/theme.md): exactly 13 colours per mode, and every colour the plugin
// contributes is one of them. Dark is Desktop Plus; light follows SeaTalk's light theme arrangement of Tokyo Night Light
// tones. Keep the values equal to the --palette-* primitives in src/index.css for each mode (and to
// packages/app/src/patches/vibing/palette.ts, which restates them because a plugin cannot import app source).
interface Primitives {
  /** neutral-850: the canvas. */
  canvas: string;
  /** neutral-800: the raised card. */
  raised: string;
  /** neutral-750: hover. */
  hover: string;
  /** neutral-700: selected. */
  selected: string;
  /** neutral-400: faint text. */
  faint: string;
  /** neutral-300: subdued text. */
  subdued: string;
  /** neutral-200: the default text. */
  text: string;
  border: string;
  blue: string;
  green: string;
  yellow: string;
  red: string;
  purple: string;
}

const PALETTES = {
  dark: {
    canvas: "#1d2125",
    raised: "#24292e",
    hover: "#2f363d",
    selected: "#444d56",
    faint: "#959da5",
    subdued: "#d1d5da",
    text: "#f6f8fa",
    border: "#2b3137",
    blue: "#79b8ff",
    green: "#28a745",
    yellow: "#f9c513",
    red: "#f97583",
    purple: "#b392f0",
  },
  light: {
    canvas: "#d6d8df",
    raised: "#e6e7ed",
    hover: "#cbcdd3",
    selected: "#c6c9cf",
    faint: "#686a77",
    subdued: "#4c505e",
    text: "#343b59",
    border: "#c1c2c7",
    blue: "#395d99",
    green: "#33635c",
    yellow: "#7e5211",
    red: "#8c4351",
    purple: "#7540b1",
  },
} as const satisfies Record<"dark" | "light", Primitives>;

// One role mapping for both modes: background = canvas; raised and raisedStrong = hover (Paseo's surface1 and surface3:
// composer, bubbles, secondary fills); control = the raised card (surface2); sidebar = canvas (the list, tab strip
// and settings navigation); popover = the raised card (tooltips and hover cards); border = its own value;
// accent = blue; foreground = the default text; mutedForeground = subdued text; ring = faint text (Paseo also
// uses ring for placeholders, muted controls and terminal bright black).
// Embedded frames pick the theme of the host's mode in memory; see patches/vibing/theme.ts.
function colorsFor(p: Primitives) {
  return {
    background: p.canvas,
    foreground: p.text,
    raised: p.hover,
    control: p.raised,
    border: p.border,
    raisedStrong: p.hover,
    sidebar: p.canvas,
    popover: p.raised,
    accent: p.blue,
    mutedForeground: p.subdued,
    ring: p.faint,
  };
}

export default function contribute(client: PluginClientContext) {
  const removeDark = client.addTheme({
    id: "dark",
    name: "Space App Vibing",
    appearance: "dark",
    colors: colorsFor(PALETTES.dark),
  });
  const removeLight = client.addTheme({
    id: "light",
    name: "Space App Vibing Light",
    appearance: "light",
    colors: colorsFor(PALETTES.light),
  });
  return async () => {
    await removeLight();
    await removeDark();
  };
}
