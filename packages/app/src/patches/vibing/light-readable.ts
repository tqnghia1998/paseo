import { isEmbeddedFocusMode } from "./focus-mode";

// Upstream's light colours (status, diff, syntax, terminal ANSI) were picked for a white page. Space App
// Vibing's light surfaces are the grey canvas #d6d8df, the neutral raised tone #cbcdd3 and raised #e6e7ed, where
// many of them fall under 4.5:1 (ANSI white is 1.4:1). In the embedded build each of those colours is
// darkened toward black by the least amount that reaches the floor on every given surface, so hues are
// kept, nothing is a new palette value, and colours that already pass are untouched. Dark and the
// standalone light theme never go through this.

const HEX = /^#[0-9a-fA-F]{6}$/;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function darken(hex: string, keep: number): string {
  return `#${channels(hex)
    .map((value) =>
      Math.round(value * keep)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** `color` mixed with black just enough to reach `floor` against every surface; other values are returned as given. */
export function readableOnSurfaces(
  color: string,
  surfaces: readonly string[],
  floor: number,
): string {
  if (!HEX.test(color) || !surfaces.every((surface) => HEX.test(surface))) return color;
  for (let keep = 100; keep >= 0; keep -= 1) {
    const candidate = keep === 100 ? color.toLowerCase() : darken(color, keep / 100);
    if (surfaces.every((surface) => ratio(candidate, surface) >= floor)) {
      return keep === 100 ? color : candidate;
    }
  }
  return color;
}

/** Applies `readableOnSurfaces` to every value in the embedded build, and returns `colors` itself elsewhere. */
export function resolveLightReadable<T extends Record<string, string>>(
  colors: T,
  surfaces: readonly string[],
  floor: number,
): T {
  if (!isEmbeddedFocusMode) return colors;
  return Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [key, readableOnSurfaces(value, surfaces, floor)]),
  ) as T;
}
