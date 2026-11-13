/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { darkTheme, lightTheme, PLUGIN_THEME_PREFERENCE } from "@/styles/theme";
import type { PluginThemeOption } from "@/plugins/themes";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
import { resolveEmbeddedThemeInput, VIBING_THEME_IDS } from "./theme";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

const dark: PluginThemeOption = {
  id: "space-app-vibing-theme/theme/dark",
  serverId: "server",
  name: "Space App Vibing",
  swatch: "#1d2125",
  theme: darkTheme,
};
const light: PluginThemeOption = {
  id: "space-app-vibing-theme/theme/light",
  serverId: "server",
  name: "Space App Vibing Light",
  swatch: "#ffffff",
  theme: lightTheme,
};
const other: PluginThemeOption = {
  ...dark,
  id: "someone/theme/dark",
  name: "Other",
};
const saved = {
  preference: PLUGIN_THEME_PREFERENCE,
  contributedTheme: other,
} as const;

it("names the two bundled themes", () => {
  expect(VIBING_THEME_IDS).toEqual({
    dark: "space-app-vibing-theme/theme/dark",
    light: "space-app-vibing-theme/theme/light",
  });
});

it("follows the host mode in an embedded frame, whatever the saved appearance", () => {
  const options = [other, dark, light];
  expect(resolveEmbeddedThemeInput(saved, options, "light")).toEqual({
    preference: PLUGIN_THEME_PREFERENCE,
    contributedTheme: light,
  });
  expect(resolveEmbeddedThemeInput(saved, options, "dark")).toEqual({
    preference: PLUGIN_THEME_PREFERENCE,
    contributedTheme: dark,
  });
  // A host that sends no mode is the dark default.
  expect(resolveEmbeddedThemeInput(saved, options, null).contributedTheme).toBe(dark);
});

it("uses the matching built-in theme until the plugin catalog arrives", () => {
  expect(resolveEmbeddedThemeInput(saved, [], "light")).toEqual({
    preference: "light",
    contributedTheme: null,
  });
  expect(resolveEmbeddedThemeInput(saved, [], null)).toEqual({
    preference: "dark",
    contributedTheme: null,
  });
});

it("leaves standard Paseo appearance preferences alone", async () => {
  vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "false");
  const standard = await import("./theme");
  expect(standard.resolveEmbeddedThemeInput(saved, [dark, light], "light")).toBe(saved);
  const builtIn = { preference: "zinc", contributedTheme: null } as const;
  expect(standard.resolveEmbeddedThemeInput(builtIn, [dark, light], "light")).toBe(builtIn);
});

it("selects in memory: never saves settings or writes browser storage", () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  resolveEmbeddedThemeInput(saved, [dark, light], "light");
  expect(setItem).not.toHaveBeenCalled();
  const source = readFileSync(resolve(__dirname, "./theme.ts"), "utf8");
  expect(source).not.toMatch(/updateSettings|useAppSettings|localStorage|\bselect\(/);
  // The provider resolves the embedded input before applying it and passes the mode to Chief.
  const provider = readFileSync(resolve(__dirname, "../../appearance/provider.tsx"), "utf8");
  expect(provider).toMatch(/resolveEmbeddedThemeInput\(/);
  expect(provider).toContain("applyTheme(themeInput)");
  expect(provider).toContain("useHostThemeMode()");
});

it("keeps native normal-chat widths and the Bots default while preserving saved widths", async () => {
  const { resolveChatContentMaxWidth } = await import("./chat-appearance");
  expect(resolveChatContentMaxWidth({ contentMaxWidth: null }, "/h/server/workspace/one")).toBe(
    820,
  );
  expect(
    resolveChatContentMaxWidth(
      { contentMaxWidth: null },
      "/h/server/plugin/paseo-bots/sidebar/bots",
    ),
  ).toBe(1200);
  expect(
    resolveChatContentMaxWidth(
      { contentMaxWidth: 1600 },
      "/h/server/plugin/paseo-bots/sidebar/bots",
    ),
  ).toBe(1600);
});
