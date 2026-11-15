// The Space App Vibing palette: exactly 13 colours per mode, and nothing else. Every surface of an embedded frame
// (the default tints, the Chief frame, the theme plugin) is derived from these by the SAME role mapping in light and
// dark; a mode only changes the values, never which colour plays which role. Values equal Space App Vibing's
// `--palette-*` primitives (docs/theme.md); `plugins/space-app-vibing-theme/index.client.ts` restates them because a
// plugin cannot import app source (`palette.test.ts` keeps both in step), and `docs/theme-sites.md` lists every place
// a primitive is a literal hex.
export interface VibingPrimitives {
  /** neutral-850: the canvas (every panel, chat, list, inputs placed on the canvas). */
  canvas: string;
  /** neutral-800: the raised card (cards, boxes, menus, popovers). */
  raised: string;
  /** neutral-750: hovered rows and the embedded frames' secondary fills. */
  hover: string;
  /** neutral-700: the selected tone and strong borders. */
  selected: string;
  /** neutral-400: faint text (hints, placeholders, disabled). */
  faint: string;
  /** neutral-300: subdued text. */
  subdued: string;
  /** neutral-200: the default text. */
  text: string;
  /** The border (hairlines and outlines). */
  border: string;
  blue: string;
  green: string;
  yellow: string;
  red: string;
  purple: string;
}

export const VIBING_PALETTES = {
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
    canvas: "#f2f2f6",
    raised: "#ffffff",
    hover: "#e9e9f4",
    selected: "#dbdbe4",
    faint: "#7b7d7f",
    subdued: "#5e5e77",
    text: "#202325",
    border: "#dddde2",
    blue: "#1571be",
    green: "#0f811c",
    yellow: "#926610",
    red: "#d91e28",
    purple: "#5c4dff",
  },
} as const satisfies Record<"dark" | "light", VibingPrimitives>;

/**
 * The colours of the `space-app-vibing-theme` plugin, from a palette. One mapping for both modes: this is the
 * only place that decides which primitive plays which Paseo role.
 */
export function pluginThemeColors(p: VibingPrimitives) {
  return {
    background: p.canvas,
    foreground: p.text,
    raised: p.hover,
    control: p.raised,
    border: p.border,
    raisedStrong: p.hover,
    sidebar: p.canvas,
    popover: p.raised,
    selected: p.selected,
    accent: p.blue,
    mutedForeground: p.subdued,
    ring: p.faint,
  };
}

/** The role a hex plays in a mode's palette (`canvas`, `hover`, ...), or undefined for any other value. */
export function paletteRole(
  mode: "dark" | "light",
  hex: string,
): keyof VibingPrimitives | undefined {
  const palette: VibingPrimitives = VIBING_PALETTES[mode];
  return (Object.keys(palette) as (keyof VibingPrimitives)[]).find((role) => palette[role] === hex);
}
