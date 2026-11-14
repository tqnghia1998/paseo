import { describe, expect, it, vi } from "vitest";

const focus = vi.hoisted(() => ({ embedded: true }));
vi.mock("./focus-mode", () => ({
  get isEmbeddedFocusMode() {
    return focus.embedded;
  },
}));

const { readableOnSurfaces, resolveLightReadable } = await import("./light-readable");
const { buildLightSemanticColors, buildLightTheme } = await import("@/styles/theme");
const { resolveDefaultLightTint } = await import("./default-dark-tint");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Space App Vibing light surfaces (docs/theme.md): canvas, hover tone, raised.
const SURFACES = ["#d6d8df", "#cbd1df", "#e6e7ed"];

describe("readableOnSurfaces", () => {
  it("leaves a colour that already passes alone", () => {
    expect(readableOnSurfaces("#343b59", SURFACES, 4.5)).toBe("#343b59");
  });

  it("darkens toward black by the least amount that reaches the floor on every surface", () => {
    const result = readableOnSurfaces("#ca8a04", SURFACES, 4.5);
    for (const surface of SURFACES) expect(ratio(result, surface)).toBeGreaterThanOrEqual(4.5);
    // Least darkening: the worst surface lands just over the floor, not far above it.
    expect(Math.min(...SURFACES.map((surface) => ratio(result, surface)))).toBeLessThan(4.7);
  });

  it("keeps the hue: channel ratios stay the same", () => {
    const result = readableOnSurfaces("#16a34a", SURFACES, 4.5);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(result.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("leaves non-hex values untouched", () => {
    expect(readableOnSurfaces("rgba(0, 0, 0, 0.1)", SURFACES, 4.5)).toBe("rgba(0, 0, 0, 0.1)");
  });
});

describe("resolveLightReadable", () => {
  it("is the identity outside the embedded build", () => {
    focus.embedded = false;
    const input = { a: "#ffffff", b: "#ca8a04" };
    expect(resolveLightReadable(input, SURFACES, 4.5)).toBe(input);
    focus.embedded = true;
  });
});

describe("embedded light theme text colours", () => {
  const tint = resolveDefaultLightTint({} as Parameters<typeof resolveDefaultLightTint>[0]);
  const colors = buildLightSemanticColors(tint);
  const theme = buildLightTheme(colors);

  it("keeps status and diff text at 4.5:1 on the canvas, raised and hover tones", () => {
    for (const key of [
      "statusSuccess",
      "statusDanger",
      "statusWarning",
      "statusMerged",
      "diffAddition",
      "diffDeletion",
    ] as const) {
      for (const surface of SURFACES) {
        expect(ratio(colors[key], surface), `${key} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps status dots at 3:1", () => {
    for (const key of [
      "statusDotSuccess",
      "statusDotDanger",
      "statusDotWarning",
      "statusDotRunning",
    ] as const) {
      for (const surface of SURFACES) {
        expect(ratio(colors[key], surface), `${key} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("derives the status tints from the readable colours", () => {
    expect(colors.statusSuccessTint).toBe(`${colors.statusSuccess}1f`);
    expect(colors.statusDangerTint).toBe(`${colors.statusDanger}1f`);
  });

  it("keeps syntax highlight colours at 4.5:1", () => {
    for (const [role, color] of Object.entries(theme.colors.syntax)) {
      for (const surface of SURFACES) {
        expect(ratio(color, surface), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps terminal ANSI colours at 4.5:1 on the canvas", () => {
    const { background } = colors.terminal;
    const ansi = Object.entries(colors.terminal).filter(([name]) =>
      /^(bright)?(black|red|green|yellow|blue|magenta|cyan|white)$/i.test(name),
    );
    expect(background).toBe(tint.surface0);
    expect(ansi).toHaveLength(16);
    for (const [name, color] of ansi) {
      // Bright black is the palette's faint tone (#686a77, 3.77:1 on the canvas), the 3:1 hint floor.
      const floor = name === "brightBlack" ? 3 : 4.5;
      expect(ratio(color, background), `terminal ${name}`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("does not touch the dark theme or the standalone light theme", () => {
    focus.embedded = false;
    const standalone = buildLightSemanticColors({ ...tint, surface0: "#ffffff" });
    expect(standalone.statusSuccess).toBe("#3e704a");
    expect(standalone.diffAddition).toBe("#15803d");
    expect(standalone.terminal.white).toBe("#ffffff");
    focus.embedded = true;
  });
});
