import { describe, expect, it, vi } from "vitest";

vi.mock("./focus-mode", () => ({ isEmbeddedFocusMode: true }));

const { resolveDefaultDarkTint, resolveDefaultLightTint } = await import("./default-dark-tint");
const { paletteRole, VIBING_PALETTES } = await import("./palette");

function contrastOf(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Upstream's own destructive colour is kept (the light builder darkens it for readability).
const UPSTREAM = { destructive: "#b04138" };

describe("Space App Vibing default tints", () => {
  it("gives borders their own value and keeps surface3 on the hover tone", () => {
    const dark = resolveDefaultDarkTint(UPSTREAM as Parameters<typeof resolveDefaultDarkTint>[0]);
    expect(dark).toMatchObject({
      border: "#2b3137",
      borderAccent: "#2b3137",
      surface1: "#2f363d",
      surface3: "#2f363d",
    });
    const light = resolveDefaultLightTint(
      UPSTREAM as Parameters<typeof resolveDefaultLightTint>[0],
    );
    expect(light).toMatchObject({
      border: "#dddde2",
      borderAccent: "#dddde2",
      surface0: "#f2f2f6",
      surface1: "#e9e9f4",
      surface2: "#ffffff",
      surface3: "#e9e9f4",
      foreground: "#202325",
      accent: "#1571be",
      destructive: "#b04138",
    });
  });

  it("derives both tints from the palette with the same role mapping", () => {
    const roles = (tint: object, mode: "dark" | "light") =>
      Object.fromEntries(
        Object.entries(tint as Record<string, string>).map(([key, value]) => [
          key,
          paletteRole(mode, value) ?? `literal:${value}`,
        ]),
      );
    const dark = roles(
      resolveDefaultDarkTint(UPSTREAM as Parameters<typeof resolveDefaultDarkTint>[0]),
      "dark",
    );
    const light = roles(
      resolveDefaultLightTint(UPSTREAM as Parameters<typeof resolveDefaultLightTint>[0]),
      "light",
    );
    expect(dark.selected).toBe("selected");
    expect(light.selected).toBe("selected");
    // Light adds primary and its foreground (the roles dark's builder derives itself) and a text-coloured ANSI black.
    const { primary, primaryForeground, ...lightShared } = light;
    expect(primary).toBe("text");
    expect(primaryForeground).toBe("canvas");
    expect({ ...lightShared, terminalBlack: undefined }).toEqual({
      ...dark,
      terminalBlack: undefined,
    });
    expect(dark.terminalBlack).toBe("raised");
    expect(light.terminalBlack).toBe("text");
  });

  it("darkens the upstream light destructive colour to stay readable on the canvas, raised and hover tones", async () => {
    const { buildLightSemanticColors } = await import("@/styles/theme");
    const tint = resolveDefaultLightTint(UPSTREAM as Parameters<typeof resolveDefaultLightTint>[0]);
    const light = { ...tint, destructive: buildLightSemanticColors(tint).destructive };
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const surface of [light.surface0, light.surface2, light.surface1]) {
      expect(ratio(light.destructive, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the light status dots at 3:1 on the canvas, raised, hover and selected tones", async () => {
    const { buildLightSemanticColors } = await import("@/styles/theme");
    const base = resolveDefaultLightTint(UPSTREAM as Parameters<typeof resolveDefaultLightTint>[0]);
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const tint = base;
    const colors = buildLightSemanticColors(tint);
    const surfaces = [tint.surface0, tint.surface1, tint.surface2, tint.selected!];
    for (const dot of [
      colors.statusDotRunning,
      colors.statusDotSuccess,
      colors.statusDotWarning,
      colors.statusDotDanger,
    ])
      for (const surface of surfaces)
        expect(ratio(dot, surface), `${dot} on ${surface}`).toBeGreaterThanOrEqual(3);
  });

  // The one documented exception to "same role in both modes": ANSI black. It is the terminal's darkest colour, so on a
  // light canvas it is the default text; the raised card (dark's role) would be unreadable there.
  it("keeps ANSI black as an explicit exception: raised in dark, the default text in light", () => {
    const dark = resolveDefaultDarkTint(UPSTREAM as Parameters<typeof resolveDefaultDarkTint>[0]);
    const light = resolveDefaultLightTint(
      UPSTREAM as Parameters<typeof resolveDefaultLightTint>[0],
    );
    expect(paletteRole("dark", dark.terminalBlack)).toBe("raised");
    expect(paletteRole("light", light.terminalBlack)).toBe("text");
    // Were light to follow dark's role, ANSI black would be unreadable on the canvas.
    expect(contrastOf(VIBING_PALETTES.light.raised, VIBING_PALETTES.light.canvas)).toBeLessThan(2);
    expect(contrastOf(light.terminalBlack, light.surface0)).toBeGreaterThan(7);
  });
});
