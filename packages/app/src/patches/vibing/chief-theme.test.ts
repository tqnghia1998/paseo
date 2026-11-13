import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REGISTERED_THEMES, darkTheme, lightTheme } from "@/styles/theme";
import {
  applyChiefTheme,
  CHIEF_ACCENT_COLORS,
  CHIEF_COLORS,
  CHIEF_PALETTE,
  withChiefTheme,
} from "./chief-theme";

const { updateTheme } = vi.hoisted(() => ({ updateTheme: vi.fn() }));
vi.mock("react-native-unistyles", () => ({ UnistylesRuntime: { updateTheme } }));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("Chief theme", () => {
  beforeEach(() => updateTheme.mockClear());

  it("replaces every colour token but keeps fonts, sizes, width and the chosen syntax palette", () => {
    const syntax = { keyword: "#123456" };
    const theme = {
      ...darkTheme,
      fontSize: { ...darkTheme.fontSize, base: 15 },
      contentMaxWidth: 1200,
      colors: { ...darkTheme.colors, syntax },
    } as typeof darkTheme;
    const next = withChiefTheme(theme);
    expect(next.colors.surface0).toBe(CHIEF_PALETTE.background);
    expect(next.colors.accent).toBe(CHIEF_PALETTE.accent);
    expect(next.colors.border).toBe(CHIEF_PALETTE.border);
    expect(next.colors.syntax).toBe(syntax);
    expect(next.fontSize.base).toBe(15);
    expect(next.contentMaxWidth).toBe(1200);
    expect(theme.colors.surface0).toBe(darkTheme.colors.surface0);
  });

  it("keeps success states green instead of the indigo accent, and shares the status palette", () => {
    expect(CHIEF_COLORS.success).toBe(CHIEF_COLORS.statusSuccess);
    expect(CHIEF_COLORS.success).not.toBe(CHIEF_PALETTE.accent);
    expect(CHIEF_COLORS.destructive).toBe(darkTheme.colors.destructive);
    expect(CHIEF_COLORS.statusDanger).toBe(darkTheme.colors.statusDanger);
  });

  it("only tints the accent when a light theme is selected in the shared settings", () => {
    const next = withChiefTheme(lightTheme as unknown as typeof darkTheme);
    expect(next.colors.surface0).toBe(lightTheme.colors.surface0);
    expect(next.colors).toMatchObject(CHIEF_ACCENT_COLORS);
  });

  it("is a no-op outside the Chief frame and patches every registered theme inside it", () => {
    applyChiefTheme(false);
    expect(updateTheme).not.toHaveBeenCalled();
    applyChiefTheme(true);
    expect(updateTheme.mock.calls.map(([key]) => key)).toEqual(Object.keys(REGISTERED_THEMES));
    expect(updateTheme.mock.calls.every(([, updater]) => updater === withChiefTheme)).toBe(true);
  });

  it("keeps text readable on the Space App Vibing surfaces", () => {
    const { background, control, foreground, mutedForeground, ring, accent, accentBright } =
      CHIEF_PALETTE;
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(6);
    expect(contrast(foreground, control)).toBeGreaterThanOrEqual(6);
    expect(contrast(mutedForeground, background)).toBeGreaterThanOrEqual(5.5);
    expect(contrast(mutedForeground, control)).toBeGreaterThanOrEqual(4.5);
    // Placeholders and muted controls: a non-text contrast floor.
    expect(contrast(ring, background)).toBeGreaterThanOrEqual(3.5);
    expect(contrast(accent, CHIEF_PALETTE.accentForeground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accentBright, background)).toBeGreaterThanOrEqual(5.5);
    expect(contrast(accent, background)).toBeGreaterThanOrEqual(3);
  });

  it("re-applies after each appearance update and never saves a theme choice", () => {
    const provider = readFileSync(resolve(__dirname, "../../appearance/provider.tsx"), "utf8");
    const applied = provider.indexOf("applyAppearance({");
    const themed = provider.indexOf("applyChiefTheme();");
    expect(applied).toBeGreaterThan(-1);
    expect(themed).toBeGreaterThan(applied);
    // Settings are shared by every Paseo frame: the look must stay in memory.
    const source = readFileSync(resolve(__dirname, "./chief-theme.ts"), "utf8");
    expect(source).not.toMatch(/updateSettings|useAppSettings|localStorage|\bselect\(/);
  });
});
