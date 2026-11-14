import { describe, expect, it, vi } from "vitest";

vi.mock("./focus-mode", () => ({ isEmbeddedFocusMode: true }));

const { resolveDefaultDarkTint, resolveDefaultLightTint } = await import("./default-dark-tint");

describe("Space App Vibing default tints", () => {
  it("gives borders their own value and keeps surface3 on the hover tone", () => {
    const dark = resolveDefaultDarkTint({} as Parameters<typeof resolveDefaultDarkTint>[0]);
    expect(dark).toMatchObject({
      border: "#2b3137",
      borderAccent: "#2b3137",
      surface1: "#2f363d",
      surface3: "#2f363d",
    });
    const light = resolveDefaultLightTint({} as Parameters<typeof resolveDefaultLightTint>[0]);
    expect(light).toMatchObject({
      border: "#c1c2c7",
      borderAccent: "#c1c2c7",
      surface0: "#d6d8df",
      surface1: "#cbd1df",
      surface2: "#e6e7ed",
      surface3: "#cbd1df",
      foreground: "#343b59",
      accent: "#395d99",
      destructive: "#9b3931",
    });
  });

  it("keeps the light destructive colour readable on the canvas, raised and hover tones", () => {
    const light = resolveDefaultLightTint({} as Parameters<typeof resolveDefaultLightTint>[0]);
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
});
