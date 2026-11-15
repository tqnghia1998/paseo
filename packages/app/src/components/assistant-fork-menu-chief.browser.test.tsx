import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AssistantForkMenu } from "./assistant-fork-menu";
import { BotChatForkProvider } from "@/patches/vibing/bot-chat-fork";

vi.mock("@/patches/vibing/focus-mode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/patches/vibing/focus-mode")>()),
  isEmbeddedChiefView: true,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it("omits the entire fork control in Chief's single conversation", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onFork = vi.fn();
  try {
    flushSync(() =>
      root.render(
        <BotChatForkProvider openDraft={vi.fn()}>
          <AssistantForkMenu onFork={onFork} />
        </BotChatForkProvider>,
      ),
    );
    expect(container.querySelector('[data-testid="assistant-fork-menu-trigger"]')).toBeNull();
    expect(document.querySelector('[data-testid="assistant-fork-menu-content"]')).toBeNull();
    expect(onFork).not.toHaveBeenCalled();
  } finally {
    root.unmount();
    container.remove();
  }
});
