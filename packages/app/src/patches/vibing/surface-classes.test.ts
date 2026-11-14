import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { compilePlugin } from "../../../../server/src/server/plugins/compiler";
import { collectPluginThemes } from "@/plugins/themes";
import { runPluginClientBundle, type PluginClientRuntime } from "@/plugins/evaluate";
import type { InstalledPlugin } from "@/plugins/types";
import type { PluginThemeContribution } from "@getpaseo/plugin";

vi.mock("./focus-mode", () => ({ isEmbeddedFocusMode: true, isEmbeddedChiefView: false }));

const { resolveDefaultDarkTint, resolveDefaultLightTint } = await import("./default-dark-tint");
const { buildDarkSemanticColors, buildLightSemanticColors } = await import("@/styles/theme");
const { buildChiefColors } = await import("./chief-theme");

// Space App Vibing's palette classes (docs/theme.md, "Elevation ladder"). A container that is the
// canvas in dark is the canvas in light; only the raised classes (cards, menus, popovers, the
// composer) are the lighter raised card in light. Hover and selected map by the same classes.
const CLASSES = {
  dark: {
    canvas: "#1d2125",
    raised: "#24292e",
    hover: "#2f363d",
    selected: "#444d56",
    faint: "#959da5",
  },
  light: {
    canvas: "#d6d8df",
    raised: "#e6e7ed",
    // Neutral grey, the 50/50 mix of the canvas and the border (#d6d8df, #c1c2c7): the light tone of the
    // plugin's `raised`/`raisedStrong`. The host's hover primitive (#cbd1df) reads blue and stays host-only.
    hover: "#cbcdd3",
    selected: "#bfc9df",
    faint: "#686a77",
  },
} as const;

function classOf(mode: "dark" | "light", color: string): string {
  const entry = Object.entries(CLASSES[mode]).find(([, hex]) => hex === color.toLowerCase());
  return entry ? entry[0] : `unknown(${color})`;
}

async function vibingThemes(): Promise<Record<"dark" | "light", Record<string, string>>> {
  const root = new URL("../../../../../plugins/space-app-vibing-theme/", import.meta.url);
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
  return {
    dark: byId("dark").colors as unknown as Record<string, string>,
    light: byId("light").colors as unknown as Record<string, string>,
  };
}

// Every background slot an embedded frame paints. `surfaceSidebarSelected` and
// `surfaceWorkspace` are left out on purpose: they only paint the native workspace sidebar and
// screen, which an embedded frame never mounts (the Bots list draws its own selected tone).
const BACKGROUND_SLOTS: Record<string, "canvas" | "raised" | "hover"> = {
  surface0: "canvas",
  background: "canvas",
  surfaceSidebar: "canvas",
  surface1: "hover",
  surface3: "hover",
  surfaceSidebarHover: "hover",
  surfaceDiffEmpty: "hover",
  surface2: "raised",
  popover: "raised",
  secondary: "raised",
  muted: "raised",
  input: "raised",
};

describe("Space App Vibing surface classes (light equals dark)", () => {
  it("maps every background slot of the theme plugin to the same class in both modes", async () => {
    const themes = await vibingThemes();
    const table = Object.entries(BACKGROUND_SLOTS).map(([slot, expected]) => ({
      slot,
      expected,
      dark: classOf("dark", themes.dark[slot]),
      light: classOf("light", themes.light[slot]),
    }));
    expect(table).toEqual(
      table.map(({ slot, expected }) => ({ slot, expected, dark: expected, light: expected })),
    );
  });

  it("derives the light neutral tone as the mix of the canvas and the border", () => {
    const mix = (a: string, b: string) =>
      `#${[1, 3, 5]
        .map((i) =>
          // The red midpoint is 203.5; it is truncated, so the tone is #cbcdd3.
          Math.floor(
            (Number.parseInt(a.slice(i, i + 2), 16) + Number.parseInt(b.slice(i, i + 2), 16)) / 2,
          )
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
    expect(mix("#d6d8df", "#c1c2c7")).toBe(CLASSES.light.hover);
  });

  it("keeps the dark values byte for byte", async () => {
    const { dark } = await vibingThemes();
    expect(dark.surfaceSidebar).toBe("#1d2125");
    expect(dark.popover).toBe("#24292e");
    expect(dark.surface0).toBe("#1d2125");
    expect(dark.surface1).toBe("#2f363d");
    expect(dark.surface2).toBe("#24292e");
    expect(dark.surface3).toBe("#2f363d");
    expect(dark.surfaceSidebarHover).toBe("#2f363d");
  });

  it("gives the built-in tints (before the plugin catalog loads) the same classes", () => {
    const dark = buildDarkSemanticColors(
      resolveDefaultDarkTint({} as Parameters<typeof resolveDefaultDarkTint>[0]),
    );
    const light = buildLightSemanticColors(
      resolveDefaultLightTint({} as Parameters<typeof resolveDefaultLightTint>[0]),
    );
    for (const [slot, expected] of Object.entries(BACKGROUND_SLOTS)) {
      expect(classOf("dark", dark[slot as keyof typeof dark] as string), slot).toBe(expected);
      expect(classOf("light", light[slot as keyof typeof light] as string), slot).toBe(expected);
    }
  });

  it("builds the Chief frame sidebar and popover with the same relations in both modes", () => {
    for (const mode of ["dark", "light"] as const) {
      const colors = buildChiefColors(mode);
      expect(colors.surfaceSidebar, `${mode} sidebar`).toBe(colors.surface0);
      expect(colors.popover, `${mode} popover`).toBe(colors.surface2);
    }
  });
});
