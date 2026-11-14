import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("mixes any other CSS colour in the browser, as web Unistyles style sheets only see var() references", () => {
    expect(
      resolveComposerPillHover({
        colorScheme: "light",
        colors: {
          surface1: "var(--colors-surface1)",
          surface2: "var(--colors-surface2)",
          foreground: "var(--colors-foreground)",
        },
      }),
    ).toBe("color-mix(in srgb, var(--colors-surface1) 95%, var(--colors-foreground))");
    expect(
      resolveComposerPillHover({
        colorScheme: "light",
        colors: { surface1: "rgba(0,0,0,0.1)", surface2: "#e6e7ed", foreground: "#343b59" },
      }),
    ).toBe("color-mix(in srgb, rgba(0,0,0,0.1) 95%, #343b59)");
  });

  it("keeps surface2 for dark and standalone builds whatever the colour format", () => {
    const vars = {
      surface1: "var(--colors-surface1)",
      surface2: "var(--colors-surface2)",
      foreground: "var(--colors-foreground)",
    };
    expect(resolveComposerPillHover({ colorScheme: "dark", colors: vars })).toBe(
      "var(--colors-surface2)",
    );
    focus.embedded = false;
    expect(resolveComposerPillHover({ colorScheme: "light", colors: vars })).toBe(
      "var(--colors-surface2)",
    );
  });

  it("is a theme token with real values: dark is surface2, embedded light the mix", async () => {
    const { buildDarkSemanticColors, buildLightSemanticColors } = await import("@/styles/theme");
    const { resolveDefaultDarkTint, resolveDefaultLightTint } = await import("./default-dark-tint");
    const lightColors = buildLightSemanticColors(
      resolveDefaultLightTint({} as Parameters<typeof resolveDefaultLightTint>[0]),
    );
    const darkColors = buildDarkSemanticColors(
      resolveDefaultDarkTint({} as Parameters<typeof resolveDefaultDarkTint>[0]),
    );
    expect(lightColors.composerPillHover).toBe("#c3c6cd");
    expect(darkColors.composerPillHover).toBe(darkColors.surface2);
    expect(darkColors.composerPillHover).toBe("#24292e");
  });

  it("is what the pill style sheet reads, not a value computed from the theme object", () => {
    const source = readFileSync(resolve(__dirname, "../../composer/pill-styles.ts"), "utf8");
    expect(source).toContain("backgroundColor: theme.colors.composerPillHover");
    expect(source).not.toContain("resolveComposerPillHover");
  });
});
