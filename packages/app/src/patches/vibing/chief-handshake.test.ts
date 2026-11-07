/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: {} }) },
}));

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

async function frame(options: { search?: string; framed?: boolean } = {}) {
  const parent = { postMessage: vi.fn() } as unknown as Window;
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: options.framed === false ? window : parent,
  });
  Object.defineProperty(document, "referrer", { configurable: true, value: `${origin}/` });
  history.replaceState(null, "", `/${options.search ?? "?view=chief"}`);
  vi.resetModules();
  const host = await import("./chief-host");
  const focus = await import("./focus-mode");
  const boundary = await import("./workspace-boundary");
  const send = (data: unknown, senderOrigin = origin, source: unknown = parent) =>
    window.dispatchEvent(
      new MessageEvent("message", { data, origin: senderOrigin, source: source as Window }),
    );
  return { parent, host, focus, boundary, send, handshake: host.getChiefHandshake() };
}

const init = (requestId: string, overrides: Record<string, unknown> = {}) => ({
  type: "space:chief-init",
  requestId,
  session: { ...session, ...overrides },
});

// Each test reloads the modules; drop the previous frame's window listeners.
const messageListeners: EventListener[] = [];
beforeEach(() => {
  sessionStorage.clear();
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(((type: string, listener: never) => {
    if (type === "message") messageListeners.push(listener);
    add(type, listener);
  }) as typeof window.addEventListener);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const listener of messageListeners.splice(0))
    window.removeEventListener("message", listener);
  Object.defineProperty(window, "parent", { configurable: true, value: originalParent });
  Object.defineProperty(document, "referrer", { configurable: true, value: originalReferrer });
  history.replaceState(null, "", "/");
});

describe("chief frame detection", () => {
  it("is Chief only for a framed ?view=chief entry", async () => {
    expect((await frame()).focus.isEmbeddedChiefView).toBe(true);
    expect((await frame({ search: "" })).focus.isEmbeddedChiefView).toBe(false);
    expect((await frame({ framed: false })).focus.isEmbeddedChiefView).toBe(false);
    expect((await frame({ search: "?view=bots" })).handshake).toBeNull();
    expect((await frame({ framed: false })).handshake).toBeNull();
  });

  it("allows no navigation or global shortcuts in Chief, and leaves ordinary frames alone", async () => {
    const chief = await frame();
    expect(chief.boundary.isEmbeddedRouteAllowed("/")).toBe(true);
    for (const path of ["/h/local", "/settings", "/h/local/workspace/w", "/h/local/agent/a"]) {
      expect(chief.boundary.isEmbeddedRouteAllowed(path)).toBe(false);
    }
    expect(chief.focus.isEmbeddedShortcutAllowed("message-input.action")).toBe(true);
    expect(chief.focus.isEmbeddedShortcutAllowed("agent.interrupt")).toBe(true);
    for (const action of ["command-center.toggle", "settings.toggle", "theme.cycle"]) {
      expect(chief.focus.isEmbeddedShortcutAllowed(action)).toBe(false);
    }
    const ordinary = await frame({ search: "" });
    expect(ordinary.focus.isEmbeddedShortcutAllowed("command-center.toggle")).toBe(true);
    expect(ordinary.boundary.isEmbeddedRouteAllowed("/h/local")).toBe(true);
  });
});

describe("chief handshake over window messages", () => {
  it("binds a valid init from the parent origin and acks only after verification", async () => {
    const { host, handshake, send, parent } = await frame();
    send(init("r1"));
    expect(handshake?.getState()).toMatchObject({ phase: "verifying", requestId: "r1" });
    expect(parent.postMessage).not.toHaveBeenCalled();
    handshake?.verified("r1");
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "paseo:chief-ready", requestId: "r1", agentId: "agent-1" },
      origin,
    );
    expect(host.getChiefHandshake()).toBe(handshake);
  });

  it("ignores spoofed origins, foreign sources and a query-supplied descriptor", async () => {
    const query = encodeURIComponent(JSON.stringify(session));
    const { handshake, send, parent } = await frame({ search: `?view=chief&session=${query}` });
    expect(handshake?.getState().phase).toBe("waiting");
    send(init("r1"), "https://evil.example");
    send(init("r2"), origin, { postMessage: vi.fn() });
    send(init("r3"), origin, null);
    expect(handshake?.getState()).toMatchObject({ phase: "waiting", session: null });
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("answers an invalid session with a fixed error code and does not bind", async () => {
    const { handshake, send, parent } = await frame();
    send(init("r1", { provider: "codex" }));
    send(init("r2", { port: 8251 }));
    expect(handshake?.getState().phase).toBe("waiting");
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "paseo:chief-error", requestId: "r1", reason: "invalid-session" },
      origin,
    );
  });

  it("ignores visibility before init, for stale ids and with a non-boolean value", async () => {
    const { handshake, send } = await frame();
    send({ type: "space:chief-visibility", requestId: "r1", active: true });
    expect(handshake?.getState().active).toBe(false);
    send(init("r1"));
    send({ type: "space:chief-visibility", requestId: "stale", active: true });
    send({ type: "space:chief-visibility", requestId: "r1", active: "yes" });
    expect(handshake?.getState().active).toBe(false);
    send({ type: "space:chief-visibility", requestId: "r1", active: true });
    expect(handshake?.getState().active).toBe(true);
    send({ type: "space:chief-visibility", requestId: "r1", active: false });
    expect(handshake?.getState().active).toBe(false);
  });

  it("rebinds the same identity under a new request id and drops the old one", async () => {
    const { handshake, send, parent } = await frame();
    send(init("r1"));
    handshake?.verified("r1");
    vi.mocked(parent.postMessage).mockClear();
    send(init("r2"));
    expect(handshake?.getState()).toMatchObject({ phase: "ready", requestId: "r2" });
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "paseo:chief-ready", requestId: "r2", agentId: "agent-1" },
      origin,
    );
    send({ type: "space:chief-visibility", requestId: "r1", active: true });
    expect(handshake?.getState().active).toBe(false);
  });

  it("rejects a different identity once bound", async () => {
    const { handshake, send, parent } = await frame();
    send(init("r1"));
    send(init("r2", { agentId: "agent-2" }));
    send(init("r3", { workspaceId: "workspace-2" }));
    send(init("r4", { cwd: "/repo" }));
    expect(handshake?.getState()).toMatchObject({ requestId: "r1" });
    expect(handshake?.getState().session?.agentId).toBe("agent-1");
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "paseo:chief-error", requestId: "r2", reason: "identity-changed" },
      origin,
    );
  });

  it("closes only when ready, with the current request id, never to a wildcard origin", async () => {
    const { handshake, send, parent } = await frame();
    send(init("r1"));
    handshake?.requestClose();
    expect(parent.postMessage).not.toHaveBeenCalled();
    handshake?.verified("r1");
    handshake?.requestClose();
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: "paseo:chief-close", requestId: "r1" },
      origin,
    );
    for (const [, target] of vi.mocked(parent.postMessage).mock.calls) {
      expect(target).not.toBe("*");
    }
  });

  it("posts activity only once ready, then on every change, deduplicated", async () => {
    const { handshake, send, parent } = await frame();
    const activity = () =>
      vi
        .mocked(parent.postMessage)
        .mock.calls.filter(([message]) => message.type === "paseo:chief-activity");
    handshake?.reportActivity("working");
    send(init("r1"));
    handshake?.reportActivity("needs-input");
    expect(parent.postMessage).not.toHaveBeenCalled();
    handshake?.verified("r1");
    // The ready ack is followed by the latest activity seen before it.
    expect(vi.mocked(parent.postMessage).mock.calls).toEqual([
      [{ type: "paseo:chief-ready", requestId: "r1", agentId: "agent-1" }, origin],
      [{ type: "paseo:chief-activity", requestId: "r1", state: "needs-input" }, origin],
    ]);
    handshake?.reportActivity("needs-input");
    handshake?.reportActivity("working");
    handshake?.reportActivity("working");
    handshake?.reportActivity("bogus" as never);
    handshake?.reportActivity("idle");
    expect(activity().map(([message]) => message.state)).toEqual([
      "needs-input",
      "working",
      "idle",
    ]);
    // A re-sent init or a new request id re-acks with the current activity.
    send(init("r2"));
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: "paseo:chief-activity", requestId: "r2", state: "idle" },
      origin,
    );
    for (const [, target] of vi.mocked(parent.postMessage).mock.calls) {
      expect(target).toBe(origin);
    }
  });

  it("reports verification failure with a sanitized reason and stays out of ready", async () => {
    const { handshake, send, parent } = await frame();
    send(init("r1"));
    handshake?.verified("wrong");
    expect(handshake?.getState().phase).toBe("verifying");
    handshake?.failed("r1", "Token sk-123 leaked");
    expect(handshake?.getState().phase).toBe("failed");
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: "paseo:chief-error", requestId: "r1", reason: "unavailable" },
      origin,
    );
    send(init("r2"));
    expect(handshake?.getState()).toMatchObject({ phase: "verifying", requestId: "r2" });
  });
});
