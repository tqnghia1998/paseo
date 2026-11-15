/**
 * The strength of the black scrim behind modals, sheets and palettes, as a multiplier of each site's
 * own alpha. It is one expression for every Space App Vibing theme: black whose alpha falls as the canvas
 * brightens, `16/15 - 0.48 * g / 255` of the canvas green channel. The dark canvas (#1d2125) keeps the old
 * alphas (x1.005, within 1/255 of before over every dark surface) and the white light canvas gets x0.587
 * (a 0.6 scrim becomes 0.35). A fixed black alpha cannot lighten light without changing dark, and any mix of
 * the canvas toward black scales both modes by the same factor, so the strength follows the canvas itself.
 * Desktop Plus uses the same expression (`--overlay-background-color`, `calc(0.64 - g / 885)` for 0.6).
 *
 * Other themes (upstream's standalone Paseo) have no palette and keep strength 1, so their scrims are unchanged.
 * The number is computed here in the theme builder, never from a CSS variable inside `StyleSheet.create`.
 */
export function scrimStrengthForCanvas(canvasHex: string): number {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(canvasHex);
  if (!match) return 1;
  const green = parseInt(match[2], 16);
  return Math.round((16 / 15 - (0.48 * green) / 255) * 1000) / 1000;
}

/**
 * The same strength as an opacity (at most 1) for a view that wraps a black backdrop that animates its own
 * opacity (Gorhom's sheet backdrop, the mobile panel dimmer): the wrapper's opacity multiplies the backdrop's.
 */
export function scrimOpacity(strength: number): number {
  return Math.min(1, strength);
}

/** Black at `alpha` scaled by the theme's scrim strength (`rgba(0, 0, 0, alpha)` for strength 1). */
export function scrimColor(strength: number, alpha: number): string {
  return `rgba(0, 0, 0, ${Math.round(Math.min(1, alpha * strength) * 1000) / 1000})`;
}
