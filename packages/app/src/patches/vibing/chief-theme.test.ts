import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REGISTERED_THEMES, darkTheme, lightTheme } from "@/styles/theme";
import {
  applyChiefTheme,
  buildChiefColors,
  CHIEF_ACCENT_COLORS,
  CHIEF_COLORS,
  CHIEF_PALETTES,
  withChiefTheme,
} from "./chief-theme";

// Space App Vibing's src/components/Chief/ChiefPanel.css, per mode (accent-bright is the
// resolved hex of its color-mix). Change both repositories together.
const HOST_CHIEF_CSS = {
  dark: {
    surface: "#24292e",
    control: "#2f363d",
    border: "#2b3137",
    textMuted: "#d1d5da",
    accent: "#79b8ff",
    accentBright: "#8dc3ff",
  },
  light: {
    surface: "#e6e7ed",
    control: "#cbcdd3",
    border: "#c1c2c7",
    textMuted: "#4c505e",
    accent: "#395d99",
    accentBright: "#304f82",
  },
} as const;
const CHIEF_PALETTE = CHIEF_PALETTES.dark;

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

  it("only tints the accent of a light shared-settings theme when the host sent no mode", () => {
    const next = withChiefTheme(lightTheme as unknown as typeof darkTheme);
    expect(next.colors.surface0).toBe(lightTheme.colors.surface0);
    expect(next.colors).toMatchObject(CHIEF_ACCENT_COLORS);
    // Readable on a light surface: the light-mode accent trio.
    expect(CHIEF_ACCENT_COLORS).toEqual({
      accent: CHIEF_PALETTES.light.accent,
      accentBright: CHIEF_PALETTES.light.accentBright,
      accentForeground: CHIEF_PALETTES.light.accentForeground,
    });
  });

  it("is a no-op outside the Chief frame and patches every registered theme inside it", () => {
    applyChiefTheme("dark", false);
    expect(updateTheme).not.toHaveBeenCalled();
    applyChiefTheme("light", false);
    expect(updateTheme).not.toHaveBeenCalled();
    applyChiefTheme("light", true);
    expect(updateTheme.mock.calls.map(([key]) => key)).toEqual(Object.keys(REGISTERED_THEMES));
    const updater = updateTheme.mock.calls[0][1] as (theme: typeof darkTheme) => typeof darkTheme;
    expect(updater(darkTheme).colors.surface0).toBe(CHIEF_PALETTES.light.background);
    updateTheme.mockClear();
    applyChiefTheme(null, true);
    const fallback = updateTheme.mock.calls[0][1] as (theme: typeof darkTheme) => typeof darkTheme;
    expect(fallback(darkTheme).colors.surface0).toBe(CHIEF_PALETTES.dark.background);
  });

  it.each(["dark", "light"] as const)("matches the host Chief popup colours in %s mode", (mode) => {
    const host = HOST_CHIEF_CSS[mode];
    const palette = CHIEF_PALETTES[mode];
    expect(palette).toMatchObject({
      background: host.surface,
      control: host.control,
      border: host.border,
      mutedForeground: host.textMuted,
      accent: host.accent,
      accentBright: host.accentBright,
    });
    expect(palette.accentForeground).toBe(mode === "dark" ? "#1d2125" : "#ffffff");
    const colors = buildChiefColors(mode);
    expect(colors.surface0).toBe(host.surface);
    expect(colors.background).toBe(host.surface);
    expect(colors.surface2).toBe(host.control);
    expect(colors.border).toBe(host.border);
    expect(colors.accent).toBe(host.accent);
    expect(colors.accentForeground).toBe(palette.accentForeground);
  });

  it.each(["dark", "light"] as const)("keeps text readable in %s mode", (mode) => {
    const { background, control, foreground, mutedForeground, ring, accent, accentBright } =
      CHIEF_PALETTES[mode];
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(6);
    expect(contrast(foreground, control)).toBeGreaterThanOrEqual(6);
    expect(contrast(mutedForeground, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mutedForeground, control)).toBeGreaterThanOrEqual(4.5);
    // Placeholders and muted controls: a non-text contrast floor.
    expect(contrast(ring, background)).toBeGreaterThanOrEqual(3);
    expect(contrast(accent, CHIEF_PALETTES[mode].accentForeground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accentBright, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accent, background)).toBeGreaterThanOrEqual(3);
  });

  it.each(["dark", "light"] as const)("gives borders their own colour in %s mode", (mode) => {
    const { background, control, border } = CHIEF_PALETTES[mode];
    // The border is the palette's own value, no longer the hover (control) tone.
    expect(border).not.toBe(control);
    expect(border).not.toBe(background);
    expect(contrast(border, background)).toBeGreaterThanOrEqual(1.1);
  });

  it.each(["dark", "light"] as const)(
    "keeps surface3 and the sidebar hover on the raised tone (neutral grey in light) in %s mode",
    (mode) => {
      const hover = mode === "dark" ? "#2f363d" : "#cbcdd3";
      const colors = buildChiefColors(mode);
      expect(CHIEF_PALETTES[mode].raisedStrong).toBe(hover);
      expect(colors.surface3).toBe(hover);
      expect(colors.border).toBe(CHIEF_PALETTES[mode].border);
      expect(colors.borderAccent).toBe(CHIEF_PALETTES[mode].border);
      if (mode === "light") expect(colors.surfaceSidebarHover).toBe(hover);
    },
  );

  it("builds a light colour set for the light mode and a dark one otherwise", () => {
    const light = withChiefTheme(darkTheme, "light");
    expect(light.colors.surface0).toBe(CHIEF_PALETTES.light.background);
    expect(light.colorScheme).toBe("light");
    const dark = withChiefTheme(lightTheme as unknown as typeof darkTheme, "dark");
    expect(dark.colors.surface0).toBe(CHIEF_PALETTES.dark.background);
    expect(dark.colorScheme).toBe("dark");
  });

  it("re-applies after each appearance update and never saves a theme choice", () => {
    const provider = readFileSync(resolve(__dirname, "../../appearance/provider.tsx"), "utf8");
    const applied = provider.indexOf("applyAppearance({");
    const themed = provider.indexOf("applyChiefTheme(hostMode);");
    expect(applied).toBeGreaterThan(-1);
    expect(themed).toBeGreaterThan(applied);
    // Settings are shared by every Paseo frame: the look must stay in memory.
    const source = readFileSync(resolve(__dirname, "./chief-theme.ts"), "utf8");
    expect(source).not.toMatch(/updateSettings|useAppSettings|localStorage|\bselect\(/);
  });
});
