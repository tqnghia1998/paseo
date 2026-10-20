/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const binding = vi.hoisted(() => ({ allowed: true }));
vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => ({ serverId: "host" }),
  isEmbeddedWorkspaceAllowed: () => binding.allowed,
}));
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
  window.history.replaceState(null, "", "/?embedded-live-design=1");
});
import { useEmbeddedComposerBridge } from "./composer-bridge";

type BridgeInput = Parameters<typeof useEmbeddedComposerBridge>[0];
const parent = window.parent;
const referrer = document.referrer;
const origin = "http://localhost:5183";

function setup(result: "queued" | "submitted", resolveLiveDesignAgentId?: () => string) {
  const postMessage = vi.fn();
  Object.defineProperty(window, "parent", { configurable: true, value: { postMessage } });
  Object.defineProperty(document, "referrer", { configurable: true, value: `${origin}/` });
  const waitForFinish = vi.fn<NonNullable<BridgeInput["client"]>["waitForFinish"]>(
    () => new Promise(() => {}),
  );
  let queuedSubmission: (() => Promise<void>) | undefined;
  const sendMessage = vi.fn<BridgeInput["sendMessage"]>(
    async (_text, _attachments, _force, onSubmitted) => {
      queuedSubmission = onSubmitted;
      return result;
    },
  );
  renderHook(() =>
    useEmbeddedComposerBridge({
      enabled: true,
      agentId: "agent",
      workspaceId: "workspace",
      inputMode: "chat",
      readOnly: false,
      isComposerLocked: false,
      client: { waitForFinish },
      resolveLiveDesignAgentId,
      getText: () => "Existing draft",
      replaceText: vi.fn(),
      focus: vi.fn(),
      sendMessage,
    }),
  );
  return {
    sendMessage,
    waitForFinish,
    postMessage,
    submitQueued() {
      act(() => {
        void queuedSubmission?.();
      });
    },
    async send() {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window.parent,
            origin,
            data: {
              type: "space:paseo-live-design-send",
              requestId: "request",
              text: "Apply this Live Design note.",
              contextText: "Prepared context with Tighten spacing",
            },
          }),
        );
      });
    },
  };
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  Object.defineProperty(document, "referrer", { configurable: true, value: referrer });
  sessionStorage.clear();
});

it("sends text context and starts observing the submitted conversation", async () => {
  const h = setup("submitted");
  await h.send();
  expect(h.sendMessage).toHaveBeenCalledWith(
    "Apply this Live Design note.",
    [expect.objectContaining({ kind: "text" })],
    undefined,
    expect.any(Function),
  );
  expect(h.waitForFinish).toHaveBeenCalledWith("agent", 0, {
    waitForActive: true,
    waitThroughPermission: true,
  });
});

it("waits for a queued message to submit before observing its turn", async () => {
  const h = setup("queued");
  await h.send();
  expect(h.waitForFinish).not.toHaveBeenCalled();
  h.submitQueued();
  expect(h.waitForFinish).toHaveBeenCalledWith("agent", 0, {
    waitForActive: true,
    waitThroughPermission: true,
  });
});

it("observes the real agent after a fresh draft becomes a conversation", async () => {
  const h = setup("submitted", () => "created-agent");
  await h.send();
  expect(h.waitForFinish).toHaveBeenCalledWith("created-agent", 0, {
    waitForActive: true,
    waitThroughPermission: true,
  });
});

it("does not prepare a composer from another folder for host prompts or Live Design", () => {
  binding.allowed = false;
  try {
    const { postMessage, sendMessage } = setup("submitted");
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window.parent,
          origin,
          data: { type: "space:paseo-live-design-ready-request" },
        }),
      ),
    );
    expect(postMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  } finally {
    binding.allowed = true;
  }
});
