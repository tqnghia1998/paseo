/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});

import {
  EMBEDDED_LIVE_DESIGN_SEND_TYPE,
  isEmbeddedLiveDesignSendMessage,
  shouldSettleLiveDesignTurn,
  useEmbeddedLiveDesignActivation,
  useEmbeddedLiveDesignSend,
  waitForLiveDesignTurn,
} from "./live-design";

const originalParent = window.parent;
const originalReferrer = document.referrer;
const originalSearch = window.location.search;
const origin = "https://host.example";
const contextText = "Prepared Live Design context with exact JSX and stylesheet evidence";
const attachment = {
  kind: "text",
  attachment: {
    type: "text",
    mimeType: "text/plain",
    title: "Live Design context",
    text: contextText,
  },
};

function host() {
  window.history.replaceState({}, "", "/?embedded-live-design=1");
  const postMessage = vi.fn();
  const parent = { postMessage } as unknown as Window;
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  Object.defineProperty(document, "referrer", { configurable: true, value: `${origin}/design` });
  return {
    postMessage,
    async send(data: unknown, senderOrigin = origin, source = parent) {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: senderOrigin, source, data }));
      });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "parent", { configurable: true, value: originalParent });
  Object.defineProperty(document, "referrer", { configurable: true, value: originalReferrer });
  window.history.replaceState({}, "", originalSearch || "/");
  sessionStorage.clear();
});

const message = {
  type: EMBEDDED_LIVE_DESIGN_SEND_TYPE,
  requestId: "request-1",
  text: "Apply this Live Design note.",
  contextText,
};
const obsoleteFields = [
  { images: [] },
  { images: undefined },
  {
    images: [{ noteIndex: 0, role: "before", mimeType: "image/png", bytes: new Uint8Array([137]) }],
  },
  { images: "malformed" },
  { imageGrant: null },
  {
    imageGrant: {
      sessionId: "session",
      grantId: "grant",
      agentId: "agent",
      workspaceId: "workspace",
    },
  },
];

describe("embedded Live Design bridge", () => {
  it.each(obsoleteFields)("rejects obsolete image fields: %j", async (fields) => {
    const parent = host();
    const submit = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent", enabled: true, submit }),
    );
    const obsolete = { ...message, version: 2, ...fields };
    expect(isEmbeddedLiveDesignSendMessage(obsolete)).toBe(false);
    await parent.send(obsolete);
    expect(submit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("paseo:live-design-pending")).toBeNull();
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: "paseo:live-design-send-failed",
        requestId: "request-1",
        error: "Live Design image handoff is no longer supported",
      },
      origin,
    );
    hook.unmount();
  });

  it("accepts prepared text and context without understanding note source data", () => {
    expect(isEmbeddedLiveDesignSendMessage(message)).toBe(true);
    for (const invalid of [
      { ...message, text: undefined },
      { ...message, contextText: undefined },
      { ...message, text: "" },
      { ...message, contextText: "" },
      { type: message.type, requestId: "legacy", notes: [{ comment: "old payload" }] },
    ])
      expect(isEmbeddedLiveDesignSendMessage(invalid)).toBe(false);
  });

  it.each(["succeeded", "failed", "unknown"] as const)(
    "preserves %s completion through remount and acknowledgement",
    async (outcome) => {
      const parent = host();
      const submit = vi.fn().mockResolvedValue(undefined);
      const hook = renderHook(() =>
        useEmbeddedLiveDesignSend({
          agentId: "agent",
          workspaceId: "workspace",
          enabled: true,
          submit,
        }),
      );
      await parent.send(message);
      expect(submit).toHaveBeenCalledWith(
        "Apply this Live Design note.",
        expect.any(Function),
        expect.any(Function),
        [attachment],
      );
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: "paseo:live-design-sent", requestId: "request-1" },
        origin,
      );
      expect(
        parent.postMessage.mock.calls.some(
          ([value]) => value.type === "paseo:live-design-completed",
        ),
      ).toBe(false);
      await act(async () => {
        await submit.mock.calls[0][1](outcome);
      });
      hook.unmount();
      parent.postMessage.mockClear();
      const activation = renderHook(() =>
        useEmbeddedLiveDesignActivation({
          enabled: true,
          workspaceId: "workspace",
          activateConversation: vi.fn(),
        }),
      );
      await parent.send({ type: "space:paseo-live-design-completion-sync-request" });
      expect(parent.postMessage).toHaveBeenCalledWith(
        {
          type: "paseo:live-design-completed",
          requestId: "request-1",
          outcome,
        },
        origin,
      );
      await parent.send({ type: "space:paseo-live-design-completion-ack", requestId: "request-1" });
      parent.postMessage.mockClear();
      await parent.send({ type: "space:paseo-live-design-completion-sync-request" });
      expect(parent.postMessage).not.toHaveBeenCalled();
      activation.unmount();
    },
  );

  it("recovers a pending draft request with its resolved agent and settles on remount", async () => {
    const parent = host();
    const submit = vi.fn().mockResolvedValue(undefined);
    const first = renderHook(() =>
      useEmbeddedLiveDesignSend({
        agentId: "draft",
        workspaceId: "workspace",
        isDraft: true,
        enabled: true,
        submit,
      }),
    );
    await parent.send(message);
    first.unmount();
    submit.mock.calls[0][2]("agent");
    const activateConversation = vi.fn();
    const activation = renderHook(() =>
      useEmbeddedLiveDesignActivation({
        enabled: true,
        workspaceId: "workspace",
        activateConversation,
      }),
    );
    await parent.send({ type: "space:paseo-live-design-completion-sync-request" });
    expect(activateConversation).toHaveBeenCalledWith("agent");
    activation.unmount();
    const resumed = renderHook(() =>
      useEmbeddedLiveDesignSend({
        agentId: "agent",
        workspaceId: "workspace",
        enabled: true,
        submit,
        resumePending: async (complete) => {
          await complete("succeeded");
        },
      }),
    );
    await act(async () => {});
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: "paseo:live-design-completed",
        requestId: "request-1",
        outcome: "succeeded",
      },
      origin,
    );
    resumed.unmount();
  });

  it("records completion while its conversation is inactive and replays it on return", async () => {
    const parent = host();
    const submit = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useEmbeddedLiveDesignSend({
        agentId: "agent",
        enabled: true,
        workspaceId: "workspace",
        submit,
      }),
    );
    await parent.send(message);
    hook.unmount();
    await submit.mock.calls[0][1]("succeeded");
    expect(sessionStorage.getItem("paseo:live-design-pending")).toBe("[]");
    parent.postMessage.mockClear();
    const activation = renderHook(() =>
      useEmbeddedLiveDesignActivation({
        enabled: true,
        workspaceId: "workspace",
        activateConversation: vi.fn(),
      }),
    );
    await parent.send({ type: "space:paseo-live-design-completion-sync-request" });
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "paseo:live-design-completed", requestId: "request-1", outcome: "succeeded" },
      origin,
    );
    activation.unmount();
  });

  it("correlates new-agent readiness and activates only for the trusted host", async () => {
    const parent = host();
    const activateConversation = vi.fn().mockReturnValue("draft");
    const activation = renderHook(() =>
      useEmbeddedLiveDesignActivation({
        enabled: true,
        workspaceId: "workspace",
        activateConversation,
      }),
    );
    await parent.send({ type: "space:paseo-live-design-ready-request" }, "https://foreign.example");
    expect(activateConversation).not.toHaveBeenCalled();
    await parent.send({ type: "space:paseo-live-design-ready-request" });
    expect(activateConversation).toHaveBeenCalledOnce();
    await parent.send({ type: "space:paseo-live-design-new-agent-request", requestId: "new" });
    expect(activateConversation).toHaveBeenLastCalledWith(undefined, true);
    activation.unmount();
    const composer = renderHook(() =>
      useEmbeddedLiveDesignSend({
        agentId: "draft",
        workspaceId: "workspace",
        enabled: true,
        isDraft: true,
        submit: vi.fn(),
      }),
    );
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: "paseo:live-design-ready",
        preparedText: true,
        requestId: "new",
        destination: { agentId: "draft", workspaceId: "workspace", isDraft: true },
      },
      origin,
    );
    composer.unmount();
  });

  it("preserves readiness after navigation and rejects foreign senders", async () => {
    const parent = host();
    window.history.replaceState({}, "", "/h/server/workspace/workspace");
    const submit = vi.fn();
    const hook = renderHook(() =>
      useEmbeddedLiveDesignSend({ agentId: "agent", enabled: true, submit }),
    );
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "paseo:live-design-ready", preparedText: true },
      origin,
    );
    await parent.send(message, "https://foreign.example");
    await parent.send(message, origin, window);
    expect(submit).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("reports submission failure without leaving a pending request", async () => {
    const parent = host();
    const hook = renderHook(() =>
      useEmbeddedLiveDesignSend({
        agentId: "agent",
        enabled: true,
        submit: async () => {
          throw new Error("No model selected");
        },
      }),
    );
    await parent.send(message);
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: "paseo:live-design-send-failed",
        requestId: "request-1",
        error: "No model selected",
      },
      origin,
    );
    expect(JSON.parse(sessionStorage.getItem("paseo:live-design-pending")!)).toEqual([]);
    hook.unmount();
  });

  it("settles terminal errors but not unresolved drafts or active turns", () => {
    const final = { status: "idle" as const, activeTurn: null, pendingPermissions: [] };
    expect(shouldSettleLiveDesignTurn("idle", true, final)).toBe(true);
    expect(shouldSettleLiveDesignTurn("idle", false, final)).toBe(false);
    expect(shouldSettleLiveDesignTurn("error", true, { ...final, status: "error" })).toBe(true);
    expect(
      shouldSettleLiveDesignTurn(
        "error",
        true,
        { ...final, lastError: "Turn failed" },
        "Turn failed",
      ),
    ).toBe(true);
    expect(
      shouldSettleLiveDesignTurn(
        "error",
        true,
        { ...final, lastError: "Old failure" },
        "Wait failed",
      ),
    ).toBe(false);
    expect(shouldSettleLiveDesignTurn("error", true, final)).toBe(false);
    expect(shouldSettleLiveDesignTurn("error", false, final)).toBe(false);
    expect(shouldSettleLiveDesignTurn("permission", true, final)).toBe(false);
    expect(shouldSettleLiveDesignTurn("timeout", true, final)).toBe(false);
  });

  it.each([
    null,
    { status: "idle" as const, activeTurn: null, pendingPermissions: [] },
    { status: "running" as const, activeTurn: null, pendingPermissions: [] },
    {
      status: "idle" as const,
      activeTurn: { turnId: "turn-1", startedAt: null },
      pendingPermissions: [],
    },
  ])(
    "does not fail a Live Design note when waiting errors without a finished agent: %j",
    (final) => {
      expect(shouldSettleLiveDesignTurn("error", true, final)).toBe(false);
    },
  );

  it("reconnects observation after the wait RPC rejects", async () => {
    vi.useFakeTimers();
    const waitForFinish = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection closed"))
      .mockResolvedValueOnce({
        status: "idle",
        final: { status: "idle", activeTurn: null, pendingPermissions: [] },
      });
    const completed = vi.fn();
    const waiting = waitForLiveDesignTurn({ waitForFinish }, "agent").then(completed);
    await vi.advanceTimersByTimeAsync(1_000);
    await waiting;
    expect(completed).toHaveBeenCalledWith("succeeded");
    expect(waitForFinish).toHaveBeenCalledTimes(2);
  });

  it("reports an unknown outcome when the agent closes without a terminal turn", async () => {
    const waitForFinish = vi.fn().mockResolvedValue({
      status: "idle",
      final: { status: "closed", activeTurn: null, pendingPermissions: [] },
    });
    expect(await waitForLiveDesignTurn({ waitForFinish }, "agent")).toBe("unknown");
    expect(waitForFinish).toHaveBeenCalledTimes(1);
  });

  it("waits through pending permissions before reporting completion", async () => {
    vi.useFakeTimers();
    const final = {
      status: "idle" as const,
      activeTurn: null,
      pendingPermissions: [
        {
          id: "permission",
          provider: "codex" as const,
          name: "question",
          kind: "question" as const,
        },
      ],
    };
    expect(shouldSettleLiveDesignTurn("idle", true, final)).toBe(false);
    const waitForFinish = vi
      .fn()
      .mockResolvedValueOnce({ status: "permission", final })
      .mockResolvedValueOnce({ status: "idle", final: { ...final, pendingPermissions: [] } });
    const completed = vi.fn();
    const waiting = waitForLiveDesignTurn({ waitForFinish }, "agent").then(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await waiting;
    expect(completed).toHaveBeenCalledWith("succeeded");
    expect(waitForFinish).toHaveBeenLastCalledWith("agent", 0, {
      waitForActive: false,
      waitThroughPermission: true,
    });
  });

  it("still waits for the turn to start after an observation error on an idle agent", async () => {
    vi.useFakeTimers();
    const waitForFinish = vi
      .fn()
      .mockResolvedValueOnce({
        status: "error",
        final: { status: "idle", activeTurn: null, pendingPermissions: [] },
      })
      .mockResolvedValueOnce({
        status: "idle",
        final: { status: "idle", activeTurn: null, pendingPermissions: [] },
      });
    const waiting = waitForLiveDesignTurn({ waitForFinish }, "agent");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await waiting).toBe("succeeded");
    expect(waitForFinish).toHaveBeenLastCalledWith("agent", 0, {
      waitForActive: true,
      waitThroughPermission: true,
    });
  });

  it.each(["idle", "error"] as const)(
    "keeps waiting through observation errors, then reports a terminal %s turn",
    async (status) => {
      vi.useFakeTimers();
      const waitForFinish = vi
        .fn()
        .mockResolvedValueOnce({ status: "error", final: null })
        .mockResolvedValueOnce({
          status: "error",
          final: { status: "running", activeTurn: null, pendingPermissions: [] },
        })
        .mockResolvedValueOnce({
          status,
          final: { status, activeTurn: null, pendingPermissions: [] },
        });
      const completed = vi.fn();
      const waiting = waitForLiveDesignTurn({ waitForFinish }, "agent").then(completed);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(completed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      await waiting;
      expect(completed).toHaveBeenCalledWith(status === "idle" ? "succeeded" : "failed");
      expect(waitForFinish).toHaveBeenLastCalledWith("agent", 0, {
        waitForActive: false,
        waitThroughPermission: true,
      });
    },
  );
});

it("retains fresh-agent correlation through the Settings return", async () => {
  const parent = host();
  const { rememberSettingsHandoff } = await import("./host-messages");
  rememberSettingsHandoff({
    type: "space:paseo-live-design-new-agent-request",
    requestId: "from-settings",
  });
  const activateConversation = vi.fn().mockReturnValue("settings-draft");
  const activation = renderHook(() =>
    useEmbeddedLiveDesignActivation({
      enabled: true,
      workspaceId: "workspace",
      activateConversation,
    }),
  );
  expect(activateConversation).toHaveBeenCalledExactlyOnceWith(undefined, true);
  activation.unmount();
  const composer = renderHook(() =>
    useEmbeddedLiveDesignSend({
      agentId: "settings-draft",
      workspaceId: "workspace",
      enabled: true,
      isDraft: true,
      submit: vi.fn(),
    }),
  );
  expect(parent.postMessage).toHaveBeenCalledWith(
    {
      type: "paseo:live-design-ready",
      preparedText: true,
      requestId: "from-settings",
      destination: { agentId: "settings-draft", workspaceId: "workspace", isDraft: true },
    },
    origin,
  );
  composer.unmount();
});
