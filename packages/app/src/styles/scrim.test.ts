import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { compilePlugin } from "../../../server/src/server/plugins/compiler";
import { collectPluginThemes } from "@/plugins/themes";
import { runPluginClientBundle, type PluginClientRuntime } from "@/plugins/evaluate";
import type { InstalledPlugin } from "@/plugins/types";
import type { PluginThemeContribution } from "@getpaseo/plugin";
import { VIBING_PALETTES } from "@/patches/vibing/palette";
import { scrimColor, scrimOpacity, scrimStrengthForCanvas } from "./scrim";

const focus = vi.hoisted(() => ({ embedded: true }));
vi.mock("@/patches/vibing/focus-mode", () => ({
  get isEmbeddedFocusMode() {
    return focus.embedded;
  },
  isEmbeddedChiefView: false,
}));

// The builtin themes are tinted to the palette only in the embedded build, so each is read in a fresh module graph.
async function builtinThemes(embedded: boolean) {
  focus.embedded = embedded;
  vi.resetModules();
  const { darkTheme, lightTheme } = await import("./theme");
  return { darkTheme, lightTheme };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const composite = (background: string, alpha: number) =>
  rgb(background).map((channel) => (1 - alpha) * channel);
const alphaOf = (color: string) => Number(/, ([0-9.]+)\)$/.exec(color)![1]);

// Every site that dims what is behind it, with its own alpha before the scrim followed the canvas.
const SITE_ALPHAS = [0.35, 0.45, 0.5, 0.55];

async function vibingThemes() {
  const root = new URL("../../../../plugins/space-app-vibing-theme/", import.meta.url);
  const { clientBundle } = await compilePlugin({
    client: fileURLToPath(new URL("index.client.ts", root)),
    server: fileURLToPath(new URL("index.server.ts", root)),
  });
  const evaluated = runPluginClientBundle(
    "space-app-vibing-theme",
    clientBundle!,
    {} as unknown as PluginClientRuntime,
  );
  const plugin = {
    id: "space-app-vibing-theme",
    serverId: "host",
    themes: evaluated.themes as PluginThemeContribution[],
    locale: "en",
    i18n: { resolve: (value: string) => value },
  } as unknown as InstalledPlugin;
  const options = collectPluginThemes([plugin], new Set(["host"]));
  const byId = (id: string) => options.find((option) => option.id.endsWith(`/theme/${id}`))!.theme;
  return { dark: byId("dark"), light: byId("light") };
}

describe("scrim strength", () => {
  it("is one expression of the canvas green channel", () => {
    expect(scrimStrengthForCanvas(VIBING_PALETTES.dark.canvas)).toBe(1.005);
    expect(scrimStrengthForCanvas(VIBING_PALETTES.light.canvas)).toBe(0.587);
    expect(scrimStrengthForCanvas("#000000")).toBe(1.067);
    expect(scrimStrengthForCanvas("not a colour")).toBe(1);
  });

  it("keeps the dark scrim within 3/255 of the old black alphas over every dark surface", () => {
    const strength = scrimStrengthForCanvas(VIBING_PALETTES.dark.canvas);
    for (const alpha of SITE_ALPHAS) {
      const after = alphaOf(scrimColor(strength, alpha));
      for (const role of ["canvas", "raised", "hover", "selected"] as const) {
        const before = composite(VIBING_PALETTES.dark[role], alpha);
        const now = composite(VIBING_PALETTES.dark[role], after);
        before.forEach((channel, index) => expect(Math.abs(channel - now[index])).toBeLessThan(1));
      }
    }
  });

  it("lightens the light scrim: black 0.5 over white drops from #808080 to about #b4b4b4", () => {
    const strength = scrimStrengthForCanvas(VIBING_PALETTES.light.canvas);
    const after = composite("#ffffff", alphaOf(scrimColor(strength, 0.5)));
    expect(after[0]).toBeGreaterThan(176);
    expect(after[0]).toBeLessThan(184);
    expect(alphaOf(scrimColor(strength, 0.6))).toBeCloseTo(0.352, 3);
  });

  it("is unchanged for strength 1", () => {
    expect(scrimColor(1, 0.5)).toBe("rgba(0, 0, 0, 0.5)");
    expect(scrimColor(1, 0.55)).toBe("rgba(0, 0, 0, 0.55)");
  });
});

describe("scrim strength in the theme builders", () => {
  it("keeps standalone Paseo's scrims unchanged", async () => {
    const { darkTheme, lightTheme } = await builtinThemes(false);
    expect(darkTheme.scrimStrength).toBe(1);
    expect(lightTheme.scrimStrength).toBe(1);
  });

  it("follows the canvas in the tinted builtin themes of the embedded build", async () => {
    const { darkTheme, lightTheme } = await builtinThemes(true);
    expect(darkTheme.scrimStrength).toBe(scrimStrengthForCanvas(darkTheme.colors.surface0));
    expect(lightTheme.scrimStrength).toBe(scrimStrengthForCanvas(lightTheme.colors.surface0));
    expect(lightTheme.scrimStrength).toBeLessThan(darkTheme.scrimStrength);
  });

  it("follows the canvas in the Space App Vibing themes of both modes", async () => {
    const themes = await vibingThemes();
    expect(themes.dark.scrimStrength).toBe(scrimStrengthForCanvas(VIBING_PALETTES.dark.canvas));
    expect(themes.light.scrimStrength).toBe(scrimStrengthForCanvas(VIBING_PALETTES.light.canvas));
  });
});

describe("modal scrim sites", () => {
  const SITES = [
    "command-center/command-center.tsx",
    "components/add-project-flow.tsx",
    "components/adaptive-modal-sheet.tsx",
    "components/agent-list.tsx",
    "hosts/host-chooser.tsx",
  ];
  it("take their colour from the theme, not a black literal", () => {
    for (const site of SITES) {
      const source = readFileSync(resolve(__dirname, "..", site), "utf8");
      expect(source, site).toContain("scrimColor(");
      expect(source, site).not.toMatch(/backgroundColor: "rgba\(0, ?0, ?0, ?0\.\d+\)"/);
    }
  });

  it("scale the animated black backdrops (bottom sheets, mobile panels) with a themed wrapper", () => {
    for (const file of [
      "components/ui/isolated-bottom-sheet-modal/sheet-backdrop.tsx",
      "components/ui/isolated-bottom-sheet-modal/sheet-backdrop.web.tsx",
      "mobile-panels/presentation.tsx",
    ]) {
      const source = readFileSync(resolve(__dirname, "..", file), "utf8");
      expect(source, file).toContain("scrimOpacity(theme.scrimStrength)");
    }
  });

  it("clamp the wrapper opacity to 1", () => {
    expect(scrimOpacity(1.005)).toBe(1);
    expect(scrimOpacity(0.587)).toBe(0.587);
    expect(scrimColor(1.067, 0.95)).toBe("rgba(0, 0, 0, 1)");
  });
});
