/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_CHAT_ONLY = "true";
});

import {
  buildEmbeddedLiveDesignPrompt,
  EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE,
  EMBEDDED_LIVE_DESIGN_COMPLETION_SYNC_REQUEST_TYPE,
  EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE,
  EMBEDDED_LIVE_DESIGN_SEND_TYPE,
  EMBEDDED_LIVE_DESIGN_SENT_TYPE,
  isEmbeddedLiveDesignSendMessage,
  useEmbeddedLiveDesignSend,
} from "./embedded-live-design";

const originalParent = window.parent;
const originalReferrer = document.referrer;
const originalSearch = window.location.search;

const useFakeParent = () => {
  window.history.replaceState({}, "", "/?embedded-live-design=1");
  const postMessage = vi.fn();
  const parent = { postMessage } as unknown as Window;
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  return { parent, postMessage };
};

afterEach(() => {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: originalParent,
  });
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value: originalReferrer,
  });
  window.history.replaceState({}, "", originalSearch || "/");
  sessionStorage.clear();
});

const note = {
  id: "note-1",
  comment: "Tighten the spacing",
  context: {
    tagName: "button",
    attributes: { class: "large generated-class", "data-testid": "save" },
    bounds: { top: 12, left: 20, width: 100, height: 32 },
    cssClasses: "large generated-class",
    cssSelector: "main > div:nth-of-type(2) > button.large",
    accessibleName: "Save profile",
    selector: 'button[data-testid="save"]',
    url: "https://example.test/settings?tab=profile",
    viewport: { width: 1440, height: 900 },
    source: {
      componentName: "SaveButton",
      filePath: "src/components/SaveButton.tsx",
      lineNumber: 18,
      columnNumber: 4,
      hierarchy: [{ filePath: "src/App.tsx", scope: "page" }],
    },
  },
  anchor: { fingerprint: "button::Save", selector: "button.large" },
};

describe("embedded Live Design bridge", () => {
  it("validates messages and builds the agent prompt", () => {
    expect(
      isEmbeddedLiveDesignSendMessage({
        type: EMBEDDED_LIVE_DESIGN_SEND_TYPE,
        requestId: "request-1",
        notes: [note],
      }),
    ).toBe(true);
    expect(
      isEmbeddedLiveDesignSendMessage({
        type: EMBEDDED_LIVE_DESIGN_SEND_TYPE,
        requestId: "request-1",
        notes: [],
      }),
    ).toBe(false);
    const prompt = buildEmbeddedLiveDesignPrompt([note]);
    expect(prompt).toBe(
      [
        "Apply this Live Design feedback.",
        "",
        "- Read the project instructions and use a relevant UI/UX or frontend skill when available.",
        "- Start with the referenced files and selectors.",
        "- Make only the requested changes.",
        "- Preserve the existing architecture and design system.",
        "- Do not browse to verify the supplied page.",
        "- Do not run builds or tests.",
        "- Do not make unrelated refactors.",
        "",
        "# Request 1",
        "",
        "- Comment: Tighten the spacing",
        "- File: src/components/SaveButton.tsx:18:4",
        "- Page: https://example.test/settings?tab=profile",
        "- Viewport: 1440 × 900",
        '- Selector: button[data-testid="save"]',
        "- Accessible name: Save profile",
      ].join("\n"),
    );
    expect(prompt).not.toContain("note-1");
    expect(prompt).not.toContain("Element context:");
    expect(prompt).not.toContain("Anchor:");
    expect(prompt).not.toContain("CSS patch:");
  });

  it("announces readiness after Paseo replaces the embed URL", () => {
    const { postMessage } = useFakeParent();
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://host.example/live-design",
    });
    window.history.replaceState({}, "", "/h/server/workspace/workspace");

    const { unmount } = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit: vi.fn() }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      { type: "paseo:live-design-ready" },
      "https://host.example",
    );
    unmount();
  });

  it("uses the browser ancestor origin when referrer policy strips the referrer", () => {
    const { postMessage } = useFakeParent();
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "",
    });
    Object.defineProperty(window.location, "ancestorOrigins", {
      configurable: true,
      value: ["https://host.example"],
    });

    const { unmount } = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit: vi.fn() }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      { type: "paseo:live-design-ready" },
      "https://host.example",
    );
    unmount();
  });

  it("submits to the current composer and acknowledges the host", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const { parent, postMessage } = useFakeParent();
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://host.example/live-design",
    });
    const { unmount } = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit }),
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://host.example",
          source: parent,
          data: {
            type: EMBEDDED_LIVE_DESIGN_SEND_TYPE,
            requestId: "request-1",
            notes: [note],
          },
        }),
      );
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledWith(
      expect.stringContaining("# Request 1\n"),
      expect.any(Function),
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: EMBEDDED_LIVE_DESIGN_SENT_TYPE, requestId: "request-1" },
      "https://host.example",
    );
    unmount();
  });

  it("reports completion only after the submitted turn settles", async () => {
    let onSubmitted: (() => void) | undefined;
    const submit = vi.fn(async (_text: string, callback: () => void) => {
      onSubmitted = callback;
    });
    const { parent, postMessage } = useFakeParent();
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://host.example/live-design",
    });
    const { unmount } = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit }),
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://host.example",
          source: parent,
          data: {
            type: EMBEDDED_LIVE_DESIGN_SEND_TYPE,
            requestId: "request-complete",
            notes: [note],
          },
        }),
      );
      await Promise.resolve();
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: EMBEDDED_LIVE_DESIGN_SENT_TYPE, requestId: "request-complete" },
      "https://host.example",
    );
    expect(postMessage).not.toHaveBeenCalledWith(
      { type: EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE, requestId: "request-complete" },
      "https://host.example",
    );

    onSubmitted?.();

    expect(postMessage).toHaveBeenCalledWith(
      { type: EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE, requestId: "request-complete" },
      "https://host.example",
    );
    unmount();
  });

  it("replays an unacknowledged completion after a remount", async () => {
    let onTurnFinished: (() => Promise<void>) | undefined;
    const submit = vi.fn(async (_text: string, callback: () => Promise<void>) => {
      onTurnFinished = callback;
    });
    const { parent, postMessage } = useFakeParent();
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://host.example/live-design",
    });
    const first = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit }),
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://host.example",
          source: parent,
          data: {
            type: EMBEDDED_LIVE_DESIGN_SEND_TYPE,
            requestId: "request-replay",
            notes: [note],
          },
        }),
      );
      await Promise.resolve();
      await onTurnFinished?.();
    });
    first.unmount();
    postMessage.mockClear();
    const second = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit }),
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://host.example",
          source: parent,
          data: { type: EMBEDDED_LIVE_DESIGN_COMPLETION_SYNC_REQUEST_TYPE },
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE, requestId: "request-replay" },
      "https://host.example",
    );
    second.unmount();
  });

  it("settles a pending request after the iframe remounts", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const resumePending = vi.fn(async (onTurnFinished: () => Promise<void>) => {
      await onTurnFinished();
    });
    const { parent, postMessage } = useFakeParent();
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://host.example/live-design",
    });
    const first = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit }),
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://host.example",
          source: parent,
          data: {
            type: EMBEDDED_LIVE_DESIGN_SEND_TYPE,
            requestId: "request-pending",
            notes: [note],
          },
        }),
      );
      await Promise.resolve();
    });
    first.unmount();
    postMessage.mockClear();

    const second = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit, resumePending }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(resumePending).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      { type: EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE, requestId: "request-pending" },
      "https://host.example",
    );
    second.unmount();
  });

  it("ignores commands from a parent origin other than the embedding host", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const { parent } = useFakeParent();
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://host.example/live-design",
    });
    const { unmount } = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit }),
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://attacker.example",
          source: parent,
          data: {
            type: EMBEDDED_LIVE_DESIGN_SEND_TYPE,
            requestId: "request-attacker",
            notes: [note],
          },
        }),
      );
      await Promise.resolve();
    });

    expect(submit).not.toHaveBeenCalled();
    unmount();
  });

  it("reports composer submission failures", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("No model selected"));
    const { parent, postMessage } = useFakeParent();
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://host.example/live-design",
    });
    const { unmount } = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent-1", enabled: true, submit }),
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://host.example",
          source: parent,
          data: {
            type: EMBEDDED_LIVE_DESIGN_SEND_TYPE,
            requestId: "request-2",
            notes: [note],
          },
        }),
      );
      await Promise.resolve();
    });

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE,
        requestId: "request-2",
        error: "No model selected",
      },
      "https://host.example",
    );
    unmount();
  });
});
