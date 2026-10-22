/** @vitest-environment jsdom */
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Theme } from "@/styles/theme";
import { createStreamStrategy } from "./strategy";
import { TurnFooter } from "./turn-footer";

vi.mock("expo-router", () => ({ usePathname: () => "/h/test/plugin/paseo-bots/sidebar/bots" }));

vi.mock("react-native-unistyles", async () => {
  const { lightTheme } = await import("@/styles/theme");
  return {
    // Reproduce a theme width that has not caught up with the chat's route.
    StyleSheet: { create: (factory: (theme: Theme) => unknown) => factory(lightTheme) },
    withUnistyles: (Component: React.ComponentType) => Component,
  };
});
vi.mock("@/components/message", () => ({
  AssistantTurnFooter: () => <span>Completed</span>,
  LiveElapsed: () => <span>1m</span>,
  STREAM_METADATA_FONT_SIZE: 12,
}));
vi.mock("@/components/synced-loader", () => ({ SyncedLoader: () => <span>Working</span> }));
vi.mock("@/components/assistant-fork-menu", () => ({ AssistantForkMenu: () => null }));

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
  for (const container of containers.splice(0)) container.remove();
});

it("keeps a mounted loading row on the transcript rail when chat width changes", () => {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;width:1400px";
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  const strategy = createStreamStrategy({
    render: () => null,
    orderTailReverse: false,
    orderHeadReverse: false,
    assistantTurnTraversalStep: 1,
    edgeSlot: "footer",
    historyLiveBoundaryEdge: "last",
    liveHeadHistoryBoundaryEdge: "first",
    frameChildOrder: "content-then-footer",
    flatListInverted: false,
    overlayScrollbarInverted: false,
    bottomAnchorTransportBehavior: { verificationDelayFrames: 0, verificationRetryMode: "recheck" },
    disableParentScrollOnInlineDetailsExpansion: false,
    anchorBottomOnContentSizeChange: false,
    animateManualScrollToBottom: false,
    useVirtualizedList: false,
    isNearBottom: () => true,
    getBottomOffset: () => 0,
  });
  const startedAt = new Date();
  const render = (width: number) =>
    flushSync(() =>
      root.render(
        <TurnFooter
          contentMaxWidth={width}
          isRunning
          inFlightTurnStartedAt={startedAt}
          host={null}
          strategy={strategy}
          supportsTimelineCursor={false}
        />,
      ),
    );
  render(820);
  const indicator = container.querySelector<HTMLElement>('[data-testid="turn-working-indicator"]')!;
  expect(getComputedStyle(indicator.parentElement!).maxWidth).toBe("820px");
  render(1200);
  expect(container.querySelector('[data-testid="turn-working-indicator"]')).toBe(indicator);
  expect(getComputedStyle(indicator.parentElement!).maxWidth).toBe("1200px");
});
