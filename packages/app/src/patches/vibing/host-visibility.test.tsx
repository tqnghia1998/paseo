// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
import { useEmbeddedHostActive } from "./host-visibility";
const originalParent = Object.getOwnPropertyDescriptor(window, "parent")!;
const originalReferrer = Object.getOwnPropertyDescriptor(document, "referrer");
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "parent", originalParent);
  if (originalReferrer) Object.defineProperty(document, "referrer", originalReferrer);
  else Reflect.deleteProperty(document, "referrer");
  vi.restoreAllMocks();
});

it("accepts visibility only from the embedding parent origin and requests its initial state", () => {
  const parent = document.createElement("iframe");
  document.body.appendChild(parent);
  Object.defineProperty(window, "parent", { configurable: true, value: parent.contentWindow });
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value: "http://localhost:8100/",
  });
  const post = vi.spyOn(parent.contentWindow!, "postMessage");
  const { result, unmount } = renderHook(useEmbeddedHostActive);
  expect(result.current).toBe(true);
  expect(post).toHaveBeenCalledWith(
    { type: "paseo:view-visibility-request" },
    "http://localhost:8100",
  );
  const send = (source: MessageEventSource | null, origin: string, active: unknown) =>
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          origin,
          data: { type: "space:paseo-view-visibility", active },
        }),
      ),
    );
  send(window, "http://localhost:8100", false);
  expect(result.current).toBe(true);
  send(parent.contentWindow, "https://wrong.test", false);
  expect(result.current).toBe(true);
  send(parent.contentWindow, "http://localhost:8100", "false");
  expect(result.current).toBe(true);
  send(parent.contentWindow, "http://localhost:8100", false);
  expect(result.current).toBe(false);
  send(parent.contentWindow, "http://localhost:8100", true);
  expect(result.current).toBe(true);
  unmount();
  parent.remove();
});

it("leaves standalone views active without sending a host request", () => {
  const post = vi.spyOn(window, "postMessage");
  const { result } = renderHook(useEmbeddedHostActive);
  expect(result.current).toBe(true);
  expect(post).not.toHaveBeenCalled();
});
