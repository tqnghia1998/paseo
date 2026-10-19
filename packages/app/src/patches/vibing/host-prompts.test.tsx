/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
import { useEmbeddedPromptActivation, useEmbeddedPromptInsert } from "./host-prompts";

const originalParent = window.parent;
const originalReferrer = document.referrer;
const origin = "http://localhost:5183";
const policy = { workspaceId: "workspace", inputMode: "chat" as const, readOnly: false };
let requestNumber = 0;
function host() {
  const parent = { postMessage: vi.fn() } as unknown as Window;
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  Object.defineProperty(document, "referrer", { configurable: true, value: `${origin}/` });
  const send = (data: unknown, senderOrigin = origin, source = parent) => {
    act(() =>
      window.dispatchEvent(new MessageEvent("message", { data, origin: senderOrigin, source })),
    );
  };
  return {
    parent,
    send,
    prepare() {
      const requestId = `request-${++requestNumber}`;
      send({ type: "space:paseo-prompt-ready-request", requestId });
      const ready = vi
        .mocked(parent.postMessage)
        .mock.calls.find(
          ([data]) => data.type === "paseo:prompt-ready" && data.requestId === requestId,
        )?.[0];
      expect(ready).toEqual({
        type: "paseo:prompt-ready",
        requestId,
        composerId: expect.any(String),
      });
      return { requestId, composerId: ready.composerId };
    },
  };
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "parent", { configurable: true, value: originalParent });
  Object.defineProperty(document, "referrer", { configurable: true, value: originalReferrer });
});

it("appends to the current draft once per request and acknowledges delivery without submitting", () => {
  const h = host();
  let draft = "Existing draft";
  const focus = vi.fn();
  renderHook(() =>
    useEmbeddedPromptInsert({
      enabled: true,
      ...policy,
      getText: () => draft,
      replaceText: (text) => {
        draft = text;
      },
      focus,
    }),
  );
  const request = h.prepare();
  const insert = { type: "space:paseo-prompt-insert", ...request, text: "Review this" };
  h.send(insert);
  h.send(insert);
  h.send({ type: "space:paseo-prompt-insert", ...h.prepare(), text: "Then simplify" });
  expect(draft).toBe("Existing draft\n\nReview this\n\nThen simplify");
  expect(focus).toHaveBeenCalledTimes(2);
  expect(h.parent.postMessage).toHaveBeenCalledWith(
    { type: "paseo:prompt-inserted", requestId: request.requestId },
    origin,
  );
});

it("targets only the composer that answered readiness", () => {
  const h = host();
  let firstDraft = "First";
  let secondDraft = "Second";
  renderHook(() =>
    useEmbeddedPromptInsert({
      enabled: true,
      ...policy,
      getText: () => firstDraft,
      replaceText: (text) => {
        firstDraft = text;
      },
      focus: vi.fn(),
    }),
  );
  renderHook(() =>
    useEmbeddedPromptInsert({
      enabled: true,
      ...policy,
      getText: () => secondDraft,
      replaceText: (text) => {
        secondDraft = text;
      },
      focus: vi.fn(),
    }),
  );
  h.send({ type: "space:paseo-prompt-insert", ...h.prepare(), text: "Review" });
  expect(firstDraft).toBe("First\n\nReview");
  expect(secondDraft).toBe("Second");
});

it("ignores foreign origins, other frames, malformed and unsolicited insertions", () => {
  const h = host();
  const replaceText = vi.fn();
  renderHook(() =>
    useEmbeddedPromptInsert({
      enabled: true,
      ...policy,
      getText: () => "",
      replaceText,
      focus: vi.fn(),
    }),
  );
  const request = h.prepare();
  const insert = { type: "space:paseo-prompt-insert", ...request, text: "Allowed" };
  h.send(insert, "https://foreign.example");
  h.send(insert, origin, window);
  h.send({ ...insert, text: 12 });
  h.send({ ...insert, text: "" });
  h.send({ ...insert, composerId: "other" });
  h.send({ ...insert, requestId: "unprepared" });
  h.send({ type: "space:paseo-prompt-insert", text: "Old protocol" });
  expect(replaceText).not.toHaveBeenCalled();
  h.send(insert);
  expect(replaceText).toHaveBeenCalledWith("Allowed");
});

it("waits for a new handshake if the composer becomes inactive after readiness", () => {
  const h = host();
  const replaceText = vi.fn();
  const input = { enabled: true, ...policy, getText: () => "", replaceText, focus: vi.fn() };
  const hook = renderHook((props) => useEmbeddedPromptInsert(props), { initialProps: input });
  const request = h.prepare();
  const insert = { type: "space:paseo-prompt-insert", ...request, text: "Pending" };
  hook.rerender({ ...input, enabled: false });
  h.send(insert);
  expect(replaceText).not.toHaveBeenCalled();
  hook.rerender(input);
  h.send(insert);
  expect(replaceText).not.toHaveBeenCalled();
  h.send({ type: "space:paseo-prompt-ready-request", requestId: request.requestId });
  h.send(insert);
  expect(replaceText).toHaveBeenCalledOnce();
});

it.each([
  { workspaceId: undefined, inputMode: "chat" as const, readOnly: false },
  { workspaceId: "workspace", inputMode: "terminal" as const, readOnly: false },
  { workspaceId: "workspace", inputMode: "chat" as const, readOnly: true },
])("ignores non-workspace or non-editable composers: %j", (eligibility) => {
  const h = host();
  const replaceText = vi.fn();
  renderHook(() =>
    useEmbeddedPromptInsert({
      enabled: true,
      ...eligibility,
      getText: () => "Original",
      replaceText,
      focus: vi.fn(),
    }),
  );
  h.send({ type: "space:paseo-prompt-ready-request", requestId: "ineligible" });
  h.send({
    type: "space:paseo-prompt-insert",
    requestId: "ineligible",
    composerId: "any",
    text: "Unexpected",
  });
  expect(replaceText).not.toHaveBeenCalled();
  expect(h.parent.postMessage).not.toHaveBeenCalled();
});

it("activates a conversation only for a trusted correlated readiness request", () => {
  const h = host();
  const activateConversation = vi.fn();
  renderHook(() => useEmbeddedPromptActivation({ enabled: true, activateConversation }));
  h.send({ type: "space:paseo-prompt-ready-request", requestId: "new" }, "https://foreign.example");
  h.send({ type: "space:paseo-prompt-ready-request" });
  expect(activateConversation).not.toHaveBeenCalled();
  h.send({ type: "space:paseo-prompt-ready-request", requestId: "new" });
  expect(activateConversation).toHaveBeenCalledOnce();
});

it("acknowledges a retried request after a composer remount without appending twice", () => {
  const h = host();
  let draft = "";
  const replaceText = vi.fn((text: string) => {
    draft = text;
  });
  const input = { enabled: true, ...policy, getText: () => draft, replaceText, focus: vi.fn() };
  const first = renderHook(() => useEmbeddedPromptInsert(input));
  const request = h.prepare();
  h.send({ type: "space:paseo-prompt-insert", ...request, text: "Review once" });
  first.unmount();
  renderHook(() => useEmbeddedPromptInsert(input));
  h.send({ type: "space:paseo-prompt-ready-request", requestId: request.requestId });
  const ready = vi
    .mocked(h.parent.postMessage)
    .mock.calls.findLast(([data]) => data.type === "paseo:prompt-ready")![0];
  h.send({
    type: "space:paseo-prompt-insert",
    requestId: request.requestId,
    composerId: ready.composerId,
    text: "Review once",
  });
  expect(draft).toBe("Review once");
  expect(replaceText).toHaveBeenCalledOnce();
  expect(
    vi
      .mocked(h.parent.postMessage)
      .mock.calls.filter(([data]) => data.type === "paseo:prompt-inserted"),
  ).toHaveLength(2);
});

it("activates a prompt held while Settings returned to the workspace only once", async () => {
  host();
  const { rememberSettingsHandoff } = await import("./host-messages");
  expect(
    rememberSettingsHandoff({ type: "space:paseo-prompt-insert", text: "never queue sends" }),
  ).toBe(false);
  expect(
    rememberSettingsHandoff({ type: "space:paseo-prompt-ready-request", requestId: "settings" }),
  ).toBe(true);
  const activateConversation = vi.fn();
  const activation = renderHook(() =>
    useEmbeddedPromptActivation({ enabled: true, activateConversation }),
  );
  expect(activateConversation).toHaveBeenCalledTimes(1);
  activation.unmount();
  renderHook(() => useEmbeddedPromptActivation({ enabled: true, activateConversation }));
  expect(activateConversation).toHaveBeenCalledTimes(1);
});
