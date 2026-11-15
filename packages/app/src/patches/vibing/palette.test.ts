import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import contribute from "../../../../../plugins/space-app-vibing-theme/index.client";
import { paletteRole, pluginThemeColors, VIBING_PALETTES } from "./palette";

// The Space App Vibing palette is 13 colours per mode and every surface derives from it by one role mapping.
// docs/theme-sites.md lists every place a primitive is a literal; this test keeps those places the only palette-like hexes.
const HEX = /#[0-9a-fA-F]{6}\b/g;
const WHITE = "#ffffff"; // The pole both modes mix toward (accent-bright, text on selected); not a palette colour.
const PRIMITIVES = (["dark", "light"] as const).flatMap((mode) =>
  Object.values(VIBING_PALETTES[mode]),
);

function source(relative: string): string {
  return readFileSync(resolve(__dirname, relative), "utf8");
}

// Hex literals in code, with block and line comments removed (comments may quote values).
function codeHexes(relative: string): string[] {
  const code = source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return (code.match(HEX) ?? []).map((hex) => hex.toLowerCase());
}

function pluginThemes() {
  const themes: { id: string; appearance: string; colors: Record<string, string> }[] = [];
  contribute({
    addTheme: (theme: (typeof themes)[number]) => {
      themes.push(theme);
      return async () => {};
    },
  } as never);
  return themes;
}

describe("Space App Vibing palette", () => {
  it("has exactly 13 colours per mode, all six-digit hex, with the same roles in both modes", () => {
    for (const mode of ["dark", "light"] as const) {
      const values = Object.values(VIBING_PALETTES[mode]);
      expect(values).toHaveLength(13);
      for (const value of values) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(Object.keys(VIBING_PALETTES.light)).toEqual(Object.keys(VIBING_PALETTES.dark));
  });

  it("gives the theme plugin the same set of colour keys in light and dark", () => {
    const [dark, light] = pluginThemes();
    expect([dark?.appearance, light?.appearance]).toEqual(["dark", "light"]);
    expect(Object.keys(light!.colors).sort()).toEqual(Object.keys(dark!.colors).sort());
    expect(Object.keys(dark!.colors).sort()).toEqual(
      Object.keys(pluginThemeColors(VIBING_PALETTES.dark)).sort(),
    );
  });

  it("maps every plugin colour from a primitive of its own mode, by the same role in both modes", () => {
    const themes = pluginThemes();
    const roles = (colors: Record<string, string>, mode: "dark" | "light") =>
      Object.fromEntries(
        Object.entries(colors).map(([key, value]) => [
          key,
          paletteRole(mode, value) ?? `literal:${value}`,
        ]),
      );
    const [dark, light] = themes;
    expect(dark!.colors).toEqual(pluginThemeColors(VIBING_PALETTES.dark));
    expect(light!.colors).toEqual(pluginThemeColors(VIBING_PALETTES.light));
    expect(roles(light!.colors, "light")).toEqual(roles(dark!.colors, "dark"));
    expect(
      Object.values(roles(dark!.colors, "dark")).some((role) => role.startsWith("literal:")),
    ).toBe(false);
  });

  it("restates all 26 primitives as literals in the plugin and in palette.ts", () => {
    for (const file of [
      "palette.ts",
      "../../../../../plugins/space-app-vibing-theme/index.client.ts",
    ]) {
      const literals = new Set(codeHexes(file));
      for (const primitive of PRIMITIVES)
        expect(literals, `${file} ${primitive}`).toContain(primitive);
    }
  });

  it("has no light-only hex literal other than the 13 primitives in the plugin, the Chief palette and the tints", () => {
    const allowed = new Set<string>([...PRIMITIVES, WHITE]);
    for (const file of [
      "palette.ts",
      "chief-theme.ts",
      "default-dark-tint.ts",
      "../../../../../plugins/space-app-vibing-theme/index.client.ts",
    ]) {
      const strays = codeHexes(file).filter((hex) => !allowed.has(hex));
      expect(strays, file).toEqual([]);
    }
  });

  it("keeps the removed light-only tokens out of the fork", () => {
    const theme = source("../../styles/theme.ts");
    for (const removed of [
      "composerSurface",
      "composerPillHover",
      "chatFillSurface",
      "chatFillRing",
    ])
      expect(theme).not.toContain(removed);
    expect(source("../../composer/pill-styles.ts")).not.toContain("composerPillHover");
  });
});
