import { isEmbeddedFocusMode } from "./focus-mode";

// The composer's track pills (Run, the diff-stat chip) rest on surface1. In the Space App Vibing light
// theme that is the neutral grey #cbcdd3 and surface2 is the near-white raised card #e6e7ed, so the stock
// hover (surface2) jumped to white. Embedded light hovers instead go a step darker than the rest tone:
// surface1 mixed 5% toward the foreground (#cbcdd3 + #343b59 -> #c3c6cd; foreground text keeps 6.4:1 and the
// muted label 4.69:1 on it). Dark and standalone builds keep surface2.
export const COMPOSER_PILL_HOVER_MIX = 0.05;

const HEX = /^#[0-9a-f]{6}$/i;

function mixHex(base: string, toward: string, amount: number): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const target = channels(toward);
  return `#${channels(base)
    .map((value, index) =>
      Math.round(value + (target[index]! - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function resolveComposerPillHover(theme: {
  colorScheme: "light" | "dark";
  colors: { surface1: string; surface2: string; foreground: string };
}): string {
  const { surface1, surface2, foreground } = theme.colors;
  if (!isEmbeddedFocusMode || theme.colorScheme !== "light") return surface2;
  if (!HEX.test(surface1) || !HEX.test(foreground)) return surface2;
  return mixHex(surface1, foreground, COMPOSER_PILL_HOVER_MIX);
}
