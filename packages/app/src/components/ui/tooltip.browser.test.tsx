import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetainedPanel } from "@/components/retained-panel";
import { RetainedChatContent } from "@/panels/retained-chat-content.web";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

function ForkTooltipHarness({
  active,
  defaultOpen = true,
}: {
  active: boolean;
  defaultOpen?: boolean;
}) {
  return (
    <RetainedPanel active={active}>
      <RetainedChatContent>
        <Tooltip defaultOpen={defaultOpen} delayDuration={250}>
          <TooltipTrigger asChild testID="fork-trigger">
            <Pressable>
              <Text>Fork</Text>
            </Pressable>
          </TooltipTrigger>
          <TooltipContent testID="fork-tooltip">
            <Text>Fork in a new tab</Text>
          </TooltipContent>
        </Tooltip>
      </RetainedChatContent>
    </RetainedPanel>
  );
}

describe("tooltip ownership across retained chat suspension", () => {
  let root: Root;

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

  it("removes the open fork tooltip when its source tab hides and keeps it closed on return", async () => {
    flushSync(() => root.render(<ForkTooltipHarness active />));
    await expect
      .poll(() => document.querySelector('[data-testid="fork-tooltip"]')?.textContent)
      .toBe("Fork in a new tab");

    flushSync(() => root.render(<ForkTooltipHarness active={false} />));
    await expect
      .poll(() => document.querySelector("#overlay-root")?.childElementCount ?? 0)
      .toBe(0);

    flushSync(() => root.render(<ForkTooltipHarness active />));
    await expect
      .poll(() => document.querySelector("#overlay-root")?.childElementCount ?? 0)
      .toBe(0);
  });

  it("cancels a pending hover when the tab hides", async () => {
    flushSync(() => root.render(<ForkTooltipHarness active defaultOpen={false} />));
    const trigger = document.querySelector('[data-testid="fork-trigger"]')!;
    flushSync(() => trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    flushSync(() => root.render(<ForkTooltipHarness active={false} defaultOpen={false} />));
    await new Promise((resolve) => setTimeout(resolve, 350));
    flushSync(() => root.render(<ForkTooltipHarness active defaultOpen={false} />));
    expect(document.querySelector("#overlay-root")?.childElementCount ?? 0).toBe(0);

    flushSync(() => trigger.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    flushSync(() => trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await expect
      .poll(() => document.querySelector('[data-testid="fork-tooltip"]')?.textContent)
      .toBe("Fork in a new tab");
  });
});
