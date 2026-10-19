import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantForkMenu } from "./assistant-fork-menu";

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("assistant fork destinations", () => {
  let root: Root;
  const trigger = () =>
    document.querySelector<HTMLElement>('[data-testid="assistant-fork-menu-trigger"]')!;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("forks directly into a tab and locks the trigger until the fork finishes", async () => {
    let finish!: () => void;
    const onFork = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    flushSync(() => root.render(<AssistantForkMenu directTarget="tab" onFork={onFork} />));

    flushSync(() => trigger().click());
    await expect.poll(() => onFork.mock.calls.length).toBe(1);
    expect(onFork).toHaveBeenCalledWith("tab");
    expect(document.querySelector('[data-testid="assistant-fork-menu-content"]')).toBeNull();
    expect(trigger().getAttribute("aria-disabled")).toBe("true");
    flushSync(() => trigger().click());
    expect(onFork).toHaveBeenCalledTimes(1);

    finish();
    await expect.poll(() => trigger().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("keeps the normal menu and its new-workspace destination", async () => {
    const onFork = vi.fn();
    flushSync(() => root.render(<AssistantForkMenu onFork={onFork} />));
    flushSync(() => trigger().click());
    await expect
      .poll(() => document.querySelector('[data-testid="assistant-fork-menu-new-workspace"]'))
      .not.toBeNull();
    expect(onFork).not.toHaveBeenCalled();

    flushSync(() =>
      document
        .querySelector<HTMLElement>('[data-testid="assistant-fork-menu-new-workspace"]')!
        .click(),
    );
    await expect.poll(() => onFork.mock.calls.length).toBe(1);
    expect(onFork).toHaveBeenCalledWith("workspace");
  });
});
