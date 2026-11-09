import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHIEF_QUICK_ACTIONS,
  createChiefFocusBridge,
  registerChiefComposer,
  runChiefQuickAction,
} from "./chief-quick-actions";

const unregister: Array<() => void> = [];
afterEach(() => {
  for (const undo of unregister.splice(0)) undo();
});
const composer = () => {
  const actions = { send: vi.fn(), fill: vi.fn(), focus: vi.fn() };
  unregister.push(registerChiefComposer(actions));
  return actions;
};
const chip = (id: string) => CHIEF_QUICK_ACTIONS.find((action) => action.id === id)!;

describe("Chief quick actions", () => {
  it("sends a self-contained chip at once", () => {
    const actions = composer();
    expect(runChiefQuickAction(chip("overview"))).toBe(true);
    expect(actions.send).toHaveBeenCalledWith(chip("overview").text);
    expect(actions.fill).not.toHaveBeenCalled();
  });

  it("fills the composer and focuses it for a chip that needs the user's input", () => {
    const actions = composer();
    runChiefQuickAction(chip("review"));
    expect(actions.fill).toHaveBeenCalledWith("Review this merge request: ");
    expect(actions.focus).toHaveBeenCalledOnce();
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("does nothing while no composer can take input", () => {
    expect(runChiefQuickAction(chip("overview"))).toBe(false);
    const actions = composer();
    unregister.pop()!();
    expect(runChiefQuickAction(chip("overview"))).toBe(false);
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("an older composer unmounting never unregisters a newer one", () => {
    const first = { send: vi.fn(), fill: vi.fn(), focus: vi.fn() };
    const undoFirst = registerChiefComposer(first);
    const second = composer();
    undoFirst();
    runChiefQuickAction(chip("overview"));
    expect(second.send).toHaveBeenCalledOnce();
    expect(first.send).not.toHaveBeenCalled();
  });

  it("keeps ids unique and prefilled chips ending where the user continues", () => {
    expect(new Set(CHIEF_QUICK_ACTIONS.map((action) => action.id)).size).toBe(
      CHIEF_QUICK_ACTIONS.length,
    );
    for (const action of CHIEF_QUICK_ACTIONS.filter((candidate) => candidate.mode === "prefill"))
      expect(action.text.endsWith(" ")).toBe(true);
  });

  it("is wired only into the Chief frame, in the empty transcript and the composer bridge", () => {
    const view = readFileSync(resolve(__dirname, "../../agent-stream/view.tsx"), "utf8");
    const empty = view.slice(view.indexOf("function renderListEmptyComponent"));
    expect(empty.indexOf("isEmbeddedChiefView")).toBeGreaterThan(-1);
    expect(empty.indexOf("<ChiefQuickActions />")).toBeLessThan(empty.indexOf("emptyStateText"));
    // The web list never renders `listEmptyComponent`, so the chips are also laid over the
    // transcript; without this they only ever showed on native.
    expect(view).toContain("isEmbeddedChiefView && listEmptyComponent");
    expect(view).toContain("chiefEmptyOverlay");
    const bridge = readFileSync(resolve(__dirname, "./composer-bridge.ts"), "utf8");
    expect(bridge).toContain("enabled && isEmbeddedChiefView && !isComposerLocked && !readOnly");
  });
});

describe("Chief keyboard focus bridge", () => {
  it("waits for the composer to mount and focuses without changing its draft", () => {
    const receive = createChiefFocusBridge(() => ({
      phase: "ready",
      requestId: "r1",
      active: true,
    }));
    receive({ type: "space:chief-focus", requestId: "r1" });
    const actions = composer();
    expect(actions.focus).toHaveBeenCalledOnce();
    expect(actions.fill).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
    receive({ type: "space:chief-focus", requestId: "r1" });
    expect(actions.focus).toHaveBeenCalledTimes(2);
  });
  it("ignores stale requests, hidden frames and unverified sessions", () => {
    const actions = composer();
    const state = { phase: "ready", requestId: "r1", active: true };
    const receive = createChiefFocusBridge(() => state);
    receive({ type: "space:chief-focus", requestId: "stale" });
    state.active = false;
    receive({ type: "space:chief-focus", requestId: "r1" });
    state.active = true;
    state.phase = "verifying";
    receive({ type: "space:chief-focus", requestId: "r1" });
    expect(actions.focus).not.toHaveBeenCalled();
  });
  it("drops a pending focus when the popup closes before composer registration", () => {
    const state = { phase: "ready", requestId: "r1", active: true };
    createChiefFocusBridge(() => state)({ type: "space:chief-focus", requestId: "r1" });
    state.active = false;
    expect(composer().focus).not.toHaveBeenCalled();
  });
});
