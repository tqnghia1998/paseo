/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NativeBotChatProps } from "./bot-chat-types";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});

const fake = vi.hoisted(() => ({
  chat: vi.fn(),
  fetchAgent: vi.fn(),
  connected: true,
}));
vi.mock("./bot-chat", () => ({
  NativeBotChat: (props: NativeBotChatProps) => {
    fake.chat(props);
    return null;
  },
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({ fetchAgent: fake.fetchAgent }),
  useHostRuntimeIsConnected: () => fake.connected,
}));
const sessionStore = vi.hoisted(() => ({
  current: null as null | {
    setState: (state: { sessions: Record<string, unknown> }) => void;
  },
}));
vi.mock("@/stores/session-store", async () => {
  const { create } = await import("zustand");
  const store = create(() => ({ sessions: {} as Record<string, unknown> }));
  sessionStore.current = store;
  return {
    useSessionStore: store,
    // The real turn rule is covered in chief-activity.test.ts.
    selectAgentTurnPresentation: (session: { running?: Set<string> } | undefined, id: string) => ({
      isActive: session?.running?.has(id) ?? false,
    }),
  };
});

function setChiefSession(options: { running?: boolean; pending?: boolean } = {}) {
  act(() => {
    sessionStore.current!.setState({
      sessions: {
        local: {
          running: new Set(options.running ? ["agent-1"] : []),
          pendingPermissions: new Map(
            options.pending ? [["p1", { key: "p1", agentId: "agent-1", request: {} }]] : [],
          ),
        },
      },
    });
  });
}

const originalParent = window.parent;
const originalReferrer = document.referrer;
const origin = "http://localhost:5183";
const session = {
  protocol: 1,
  status: "ready",
  policy: "chief-v1",
  serverId: "local",
  agentId: "agent-1",
  workspaceId: "workspace-1",
  cwd: "/home/chief",
  provider: "claude",
};
const agent = {
  id: "agent-1",
  provider: "claude",
  cwd: "/home/chief",
  workspaceId: "workspace-1",
  labels: { "paseo-chief.policy": "chief-v1" },
  archivedAt: null,
};

async function mount(options: { agent?: unknown } = {}) {
  const parent = { postMessage: vi.fn() } as unknown as Window;
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  Object.defineProperty(document, "referrer", { configurable: true, value: `${origin}/` });
  history.replaceState(null, "", "/?view=chief");
  fake.chat.mockClear();
  fake.fetchAgent.mockReset();
  fake.fetchAgent.mockResolvedValue({ agent: options.agent ?? agent });
  vi.resetModules();
  const { ChiefEmbeddedChat } = await import("./chief-chat");
  const { KeyboardActionDispatcherProvider, useKeyboardActionDispatcher } =
    await import("@/keyboard/keyboard-action-dispatcher-context");
  let dispatcher: ReturnType<typeof useKeyboardActionDispatcher> | null = null;
  function CaptureDispatcher() {
    dispatcher = useKeyboardActionDispatcher();
    return null;
  }
  const view = render(
    <KeyboardActionDispatcherProvider>
      <CaptureDispatcher />
      <ChiefEmbeddedChat />
    </KeyboardActionDispatcherProvider>,
  );
  // What the keyboard pipeline does for Escape (`agent-interrupt` in keyboard-shortcuts.ts).
  const escape = () => {
    let handled = false;
    act(() => {
      handled = dispatcher!.dispatch({ id: "agent.interrupt", scope: "global" });
    });
    return handled;
  };
  const registerHandler = (
    ...args: Parameters<NonNullable<typeof dispatcher>["registerHandler"]>
  ) => dispatcher!.registerHandler(...args);
  const send = (data: unknown) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data, origin, source: parent }));
      await Promise.resolve();
    });
  return { parent, send, view, escape, registerHandler };
}

const messageListeners: EventListener[] = [];
beforeEach(() => {
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(((type: string, listener: never) => {
    if (type === "message") messageListeners.push(listener);
    add(type, listener);
  }) as typeof window.addEventListener);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const listener of messageListeners.splice(0))
    window.removeEventListener("message", listener);
  Object.defineProperty(window, "parent", { configurable: true, value: originalParent });
  Object.defineProperty(document, "referrer", { configurable: true, value: originalReferrer });
  history.replaceState(null, "", "/");
});

it("mounts no chat before the handshake, and none after a spoofed one", async () => {
  const { send } = await mount();
  expect(fake.chat).not.toHaveBeenCalled();
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "space:chief-init", requestId: "r1", session },
        origin: "https://evil.example",
        source: window.parent,
      }),
    );
  });
  expect(fake.fetchAgent).not.toHaveBeenCalled();
  expect(fake.chat).not.toHaveBeenCalled();
  await send({ type: "space:chief-visibility", requestId: "r1", active: true });
  expect(fake.chat).not.toHaveBeenCalled();
});

it("shows no loading text of its own: the host owns the single loading state", async () => {
  const { send, view } = await mount();
  expect(view.container.textContent).toBe("");
  // Verifying: the init arrived but the agent fetch has not settled.
  fake.fetchAgent.mockReturnValue(new Promise(() => undefined));
  await send({ type: "space:chief-init", requestId: "r1", session });
  expect(view.container.textContent).toBe("");
  expect(view.container.textContent).not.toContain("Connecting");
});

it("verifies the fetched agent, acks, then mounts the native chat for that agent only", async () => {
  const { send, parent } = await mount();
  await send({ type: "space:chief-init", requestId: "r1", session });
  await vi.waitFor(() => expect(fake.chat).toHaveBeenCalled());
  expect(fake.fetchAgent).toHaveBeenCalledWith({ agentId: "agent-1" });
  expect(parent.postMessage).toHaveBeenCalledWith(
    { type: "paseo:chief-ready", requestId: "r1", agentId: "agent-1" },
    origin,
  );
  const props: NativeBotChatProps = fake.chat.mock.calls.at(-1)![0];
  expect(props).toMatchObject({
    serverId: "local",
    botId: "vibing-chief",
    agentId: "agent-1",
    workspaceId: "workspace-1",
    cwd: "/home/chief",
    provider: "claude",
    active: false,
  });
  // Never a draft, a switch or a new conversation.
  expect(props.agentId).not.toBeNull();
  expect(props.onSelectChat("other-agent")).toBeUndefined();
  await expect(
    props.onStart({ text: "hi", messageId: "m", images: [], attachments: [] }),
  ).rejects.toThrow();
  expect(props.importLabels).toBeUndefined();
});

it("follows host visibility", async () => {
  const { send } = await mount();
  await send({ type: "space:chief-init", requestId: "r1", session });
  await vi.waitFor(() => expect(fake.chat).toHaveBeenCalled());
  await send({ type: "space:chief-visibility", requestId: "stale", active: true });
  expect(fake.chat.mock.calls.at(-1)![0].active).toBe(false);
  await send({ type: "space:chief-visibility", requestId: "r1", active: true });
  await vi.waitFor(() => expect(fake.chat.mock.calls.at(-1)![0].active).toBe(true));
});

const closeMessage = { type: "paseo:chief-close", requestId: "r1" };
const closeCalls = (parent: Window) =>
  vi
    .mocked(parent.postMessage)
    .mock.calls.filter(([message]) => (message as { type?: string }).type === "paseo:chief-close");

async function readyChief() {
  const frame = await mount();
  await frame.send({ type: "space:chief-init", requestId: "r1", session });
  await vi.waitFor(() => expect(fake.chat).toHaveBeenCalled());
  return frame;
}

it("requests close on an idle Escape while active", async () => {
  const { send, parent, escape } = await readyChief();
  await send({ type: "space:chief-visibility", requestId: "r1", active: true });
  expect(escape()).toBe(true);
  expect(parent.postMessage).toHaveBeenCalledWith(closeMessage, origin);
});

it("does not close while the frame is hidden", async () => {
  const { send, parent, escape } = await readyChief();
  expect(escape()).toBe(false);
  await send({ type: "space:chief-visibility", requestId: "r1", active: true });
  await send({ type: "space:chief-visibility", requestId: "r1", active: false });
  expect(escape()).toBe(false);
  expect(closeCalls(parent)).toHaveLength(0);
});

it("leaves Escape to a higher-priority handler that takes it, such as a running turn", async () => {
  const { send, parent, escape, registerHandler } = await readyChief();
  await send({ type: "space:chief-visibility", requestId: "r1", active: true });
  let running = true;
  const interrupt = vi.fn(() => running);
  // The composer's registration: it declines Escape when there is nothing to interrupt.
  registerHandler({
    handlerId: "composer",
    actions: ["agent.interrupt"],
    enabled: true,
    priority: 100,
    handle: interrupt,
  });
  expect(escape()).toBe(true);
  expect(interrupt).toHaveBeenCalledTimes(1);
  expect(closeCalls(parent)).toHaveLength(0);
  running = false;
  expect(escape()).toBe(true);
  expect(parent.postMessage).toHaveBeenCalledWith(closeMessage, origin);
});

it("reports activity after ready, on every change, deduplicated, even while hidden", async () => {
  const { parent, send } = await mount();
  setChiefSession({ running: true });
  expect(parent.postMessage).not.toHaveBeenCalled();
  const activity = () =>
    vi
      .mocked(parent.postMessage)
      .mock.calls.filter(
        ([message]) => (message as { type?: string }).type === "paseo:chief-activity",
      )
      .map(([message, target]) => {
        expect(target).toBe(origin);
        return message;
      });
  await send({ type: "space:chief-init", requestId: "r1", session });
  await vi.waitFor(() => expect(fake.chat).toHaveBeenCalled());
  // The ready ack carries what was observed while verifying; the chat is still hidden.
  expect(fake.chat.mock.calls.at(-1)![0].active).toBe(false);
  const ready = vi
    .mocked(parent.postMessage)
    .mock.calls.findIndex(
      ([message]) => (message as { type?: string }).type === "paseo:chief-ready",
    );
  expect(ready).toBeGreaterThanOrEqual(0);
  expect(vi.mocked(parent.postMessage).mock.calls[ready + 1]![0]).toEqual({
    type: "paseo:chief-activity",
    requestId: "r1",
    state: "working",
  });
  expect(activity()).toEqual([{ type: "paseo:chief-activity", requestId: "r1", state: "working" }]);
  setChiefSession({ running: true });
  setChiefSession({ running: true, pending: true });
  setChiefSession({ running: false });
  expect(activity().slice(1)).toEqual([
    { type: "paseo:chief-activity", requestId: "r1", state: "needs-input" },
    { type: "paseo:chief-activity", requestId: "r1", state: "idle" },
  ]);
});

it.each([
  ["a different agent", { ...agent, id: "agent-2" }],
  ["a missing policy label", { ...agent, labels: {} }],
  ["another workspace", { ...agent, workspaceId: "other" }],
  ["an archived agent", { ...agent, archivedAt: "2026-11-06T00:00:00Z" }],
  ["no agent", null],
])("never mounts the chat for %s and reports a generic error", async (_name, fetched) => {
  const { send, parent } = await mount({ agent: fetched });
  fake.fetchAgent.mockResolvedValue(fetched === null ? null : { agent: fetched });
  await send({ type: "space:chief-init", requestId: "r1", session });
  await vi.waitFor(() =>
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "paseo:chief-error", requestId: "r1" }),
      origin,
    ),
  );
  expect(fake.chat).not.toHaveBeenCalled();
});
