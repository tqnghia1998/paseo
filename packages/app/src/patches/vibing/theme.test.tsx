/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { darkTheme } from "@/styles/theme";
import type { PluginThemeOption } from "@/plugins/themes";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
const themes = vi.hoisted(() => ({
  options: [] as PluginThemeOption[],
  selected: null as PluginThemeOption | null,
  select: vi.fn(),
}));
vi.mock("@/appearance/provider", () => ({ useContributedThemes: () => themes }));
import { useEmbeddedTheme } from "./theme";

afterEach(() => {
  themes.options = [];
  themes.selected = null;
  themes.select.mockClear();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const option: PluginThemeOption = {
  id: "space-app-vibing-theme/theme/dark",
  serverId: "server",
  name: "Space App Vibing",
  swatch: "#1a1a1a",
  theme: darkTheme,
};

it("selects the bundled theme after the catalog arrives without repeatedly writing settings", () => {
  const hook = renderHook(() => useEmbeddedTheme());
  expect(themes.select).not.toHaveBeenCalled();
  themes.options = [option];
  hook.rerender();
  expect(themes.select).toHaveBeenCalledWith(option);
  themes.selected = option;
  hook.rerender();
  expect(themes.select).toHaveBeenCalledTimes(1);
});

it("leaves standard Paseo appearance preferences alone", async () => {
  vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "false");
  const { useEmbeddedTheme: useStandardTheme } = await import("./theme");
  themes.options = [option];
  renderHook(() => useStandardTheme());
  expect(themes.select).not.toHaveBeenCalled();
});
