import { isEmbeddedFocusMode } from "./focus-mode";

// The composer shell (the input box) and its pills (Import session, Run, the diff-stat chip) rest on the
// Details box tone in the embedded light build: the canvas mixed 45% toward the control (raised card) colour,
// #d6d8df + #e6e7ed -> #dddfe5, a neutral light grey (r/g/b spread 8, like the #cbcdd3 it replaces). Dark and
// standalone builds keep surface1 there. The pill hover is a step darker than that rest tone: it mixed 5%
// toward the foreground (#dddfe5 + #343b59 -> #d5d7de), so hovering never jumps to the near-white surface2.
//
// Both run while the theme is built (buildLightSemanticColors), where the colours are real values, and the
// results are the theme tokens `composerSurface` and `composerPillHover`. They must not run inside a
// StyleSheet.create function: on web Unistyles hands those functions the CSS-variable theme, where every
// string, `colorScheme` included, is a `var(--...)` reference, so a hex test or a `colorScheme` check there
// never matches.
export const COMPOSER_SURFACE_MIX = 0.45;
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

/** The composer shell and pill rest tone: the canvas mixed toward the control colour in embedded light, surface1 elsewhere. */
export function resolveComposerSurface(theme: {
  colorScheme: "light" | "dark";
  colors: { surface0: string; surface1: string; surface2: string };
}): string {
  const { surface0, surface1, surface2 } = theme.colors;
  if (!isEmbeddedFocusMode || theme.colorScheme !== "light") return surface1;
  if (!HEX.test(surface0) || !HEX.test(surface2)) {
    // Any other CSS value (var(), rgb(), ...): the browser does the same mix.
    const share = Math.round(COMPOSER_SURFACE_MIX * 100);
    return `color-mix(in srgb, ${surface0} ${100 - share}%, ${surface2})`;
  }
  return mixHex(surface0, surface2, COMPOSER_SURFACE_MIX);
}

/** The pill hover: a step darker than the rest tone in embedded light, surface2 elsewhere. */
export function resolveComposerPillHover(theme: {
  colorScheme: "light" | "dark";
  colors: { composerSurface: string; surface2: string; foreground: string };
}): string {
  const { composerSurface, surface2, foreground } = theme.colors;
  if (!isEmbeddedFocusMode || theme.colorScheme !== "light") return surface2;
  if (!HEX.test(composerSurface) || !HEX.test(foreground)) {
    const share = Math.round(COMPOSER_PILL_HOVER_MIX * 100);
    return `color-mix(in srgb, ${composerSurface} ${100 - share}%, ${foreground})`;
  }
  return mixHex(composerSurface, foreground, COMPOSER_PILL_HOVER_MIX);
}

/**
 * The fill of a chat bubble in the transcript (the user message): the composer tone in embedded light, surface3
 * elsewhere (it is the tone every other surface3 user keeps: toggle tracks, secondary buttons, skeletons).
 */
export function resolveChatFillSurface(theme: {
  colorScheme: "light" | "dark";
  colors: { composerSurface: string; surface3: string };
}): string {
  if (!isEmbeddedFocusMode || theme.colorScheme !== "light") return theme.colors.surface3;
  return theme.colors.composerSurface;
}

/**
 * The thin 1px outline of that fill in embedded light, as an inset ring (a CSS box-shadow, so it adds no layout
 * space and dark and standalone builds, where the value is `none`, stay byte-identical).
 */
export function resolveChatFillRing(theme: {
  colorScheme: "light" | "dark";
  colors: { borderAccent: string };
}): string {
  if (!isEmbeddedFocusMode || theme.colorScheme !== "light") return "none";
  return `inset 0 0 0 1px ${theme.colors.borderAccent}`;
}
