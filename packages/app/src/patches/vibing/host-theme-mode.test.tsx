// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
import {
  getHostThemeMode,
  parseHostThemeMode,
  parseHostThemeModeMessage,
  useHostThemeMode,
} from "./host-theme-mode";

const HOST = "http://localhost:8100";
const originalParent = Object.getOwnPropertyDescriptor(window, "parent")!;
const originalReferrer = Object.getOwnPropertyDescriptor(document, "referrer");

function embedIn(origin: string) {
  const parent = document.createElement("iframe");
  document.body.appendChild(parent);
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent.contentWindow,
  });
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value: `${origin}/`,
  });
  return parent;
}

function send(source: MessageEventSource | null, origin: string, data: unknown) {
  act(() => window.dispatchEvent(new MessageEvent("message", { source, origin, data })));
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "parent", originalParent);
  if (originalReferrer) Object.defineProperty(document, "referrer", originalReferrer);
  else Reflect.deleteProperty(document, "referrer");
  window.history.replaceState(null, "", "/");
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("parsing", () => {
  it("accepts only light and dark from the query", () => {
    expect(parseHostThemeMode("?themeMode=light")).toBe("light");
    expect(parseHostThemeMode("?view=chief&themeMode=dark")).toBe("dark");
    expect(parseHostThemeMode("?themeMode=purple")).toBeNull();
    expect(parseHostThemeMode("?themeMode=")).toBeNull();
    expect(parseHostThemeMode("")).toBeNull();
  });

  it("accepts only the exact space:theme-mode message", () => {
    expect(parseHostThemeModeMessage({ type: "space:theme-mode", mode: "light" })).toBe("light");
    expect(parseHostThemeModeMessage({ type: "space:theme-mode", mode: "dark" })).toBe("dark");
    expect(parseHostThemeModeMessage({ type: "space:theme-mode", mode: "purple" })).toBeNull();
    expect(parseHostThemeModeMessage({ type: "space:theme-mode" })).toBeNull();
    expect(parseHostThemeModeMessage({ type: "other", mode: "light" })).toBeNull();
    expect(parseHostThemeModeMessage(null)).toBeNull();
    expect(parseHostThemeModeMessage("space:theme-mode")).toBeNull();
  });
});

it("reads the themeMode query in an embedded frame", () => {
  window.history.replaceState(null, "", "/?themeMode=light");
  expect(getHostThemeMode()).toBe("light");
  window.history.replaceState(null, "", "/?themeMode=purple");
  expect(getHostThemeMode()).toBeNull();
});

it("starts from the query synchronously and follows only the embedding host", () => {
  window.history.replaceState(null, "", "/?themeMode=light");
  const parent = embedIn(HOST);
  const { result, unmount } = renderHook(useHostThemeMode);
  expect(result.current).toBe("light");

  send(parent.contentWindow, HOST, { type: "space:theme-mode", mode: "dark" });
  expect(result.current).toBe("dark");
  // Foreign origin, foreign source, bad values and other shapes are ignored.
  send(parent.contentWindow, "https://wrong.test", {
    type: "space:theme-mode",
    mode: "light",
  });
  expect(result.current).toBe("dark");
  send(window, HOST, { type: "space:theme-mode", mode: "light" });
  expect(result.current).toBe("dark");
  send(parent.contentWindow, HOST, {
    type: "space:theme-mode",
    mode: "purple",
  });
  send(parent.contentWindow, HOST, { type: "space:theme-mode" });
  send(parent.contentWindow, HOST, "light");
  expect(result.current).toBe("dark");
  send(parent.contentWindow, HOST, { type: "space:theme-mode", mode: "light" });
  expect(result.current).toBe("light");

  const remove = vi.spyOn(window, "removeEventListener");
  unmount();
  expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
  parent.remove();
});

it("is null in a standalone build", async () => {
  vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "false");
  vi.resetModules();
  window.history.replaceState(null, "", "/?themeMode=light");
  const standalone = await import("./host-theme-mode");
  expect(standalone.getHostThemeMode()).toBeNull();
  const { result } = renderHook(standalone.useHostThemeMode);
  expect(result.current).toBeNull();
});
