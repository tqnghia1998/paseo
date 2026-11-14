import { beforeEach, describe, expect, it, vi } from "vitest";

const focus = vi.hoisted(() => ({ embedded: true }));
vi.mock("./focus-mode", () => ({
  get isEmbeddedFocusMode() {
    return focus.embedded;
  },
  isEmbeddedChiefView: false,
}));

const { resolveComposerPillHover } = await import("./composer-pill-hover");

const light = {
  colorScheme: "light",
  colors: { surface1: "#cbcdd3", surface2: "#e6e7ed", foreground: "#343b59" },
} as const;
const dark = {
  colorScheme: "dark",
  colors: { surface1: "#2f363d", surface2: "#24292e", foreground: "#f6f8fa" },
} as const;

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("resolveComposerPillHover", () => {
  beforeEach(() => {
    focus.embedded = true;
  });

  it("is a neutral step darker than the resting pill in embedded light", () => {
    const hover = resolveComposerPillHover(light);
    expect(hover).toBe("#c3c6cd");
    expect(luminance(hover)).toBeLessThan(luminance(light.colors.surface1));
    expect(luminance(hover)).toBeLessThan(luminance("#d6d8df"));
  });

  it("keeps the label contrast on the hovered pill", () => {
    const hover = resolveComposerPillHover(light);
    expect(ratio("#343b59", hover)).toBeGreaterThanOrEqual(6);
    expect(ratio("#4c505e", hover)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves dark byte-identical", () => {
    expect(resolveComposerPillHover(dark)).toBe("#24292e");
  });

  it("leaves standalone light on surface2", () => {
    focus.embedded = false;
    expect(resolveComposerPillHover(light)).toBe("#e6e7ed");
  });

  it("falls back to surface2 for non-hex colors", () => {
    expect(
      resolveComposerPillHover({
        colorScheme: "light",
        colors: { surface1: "rgba(0,0,0,0.1)", surface2: "#e6e7ed", foreground: "#343b59" },
      }),
    ).toBe("#e6e7ed");
  });
});
