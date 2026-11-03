import React, { useCallback, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetainedPanel } from "@/components/retained-panel";
import { RetainedChatContent } from "@/panels/retained-chat-content.web";
import { AdaptiveModalSheet } from "./adaptive-modal-sheet";

vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => false,
}));

let closeSheet: () => void = () => {};
const SHEET_HEADER = { title: "Select model" };

function SheetInRetainedChat({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(true);
  const close = useCallback(() => setVisible(false), []);
  closeSheet = close;
  return (
    <RetainedPanel active={active}>
      <RetainedChatContent>
        <AdaptiveModalSheet
          header={SHEET_HEADER}
          visible={visible}
          onClose={close}
          testID="retained-sheet"
        >
          <Text>Models</Text>
        </AdaptiveModalSheet>
      </RetainedChatContent>
    </RetainedPanel>
  );
}

function sheet() {
  return document.querySelector('[data-testid="retained-sheet"]');
}

describe("AdaptiveModalSheet across retained chat suspension", () => {
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

  it("leaves no invisible overlay when the chat hides while the sheet is closing", async () => {
    flushSync(() => root.render(<SheetInRetainedChat active />));
    await expect.poll(() => sheet()?.textContent).toContain("Models");

    // The model picker closes and navigates away in one handler, e.g. Create profile.
    flushSync(() => {
      closeSheet();
      root.render(<SheetInRetainedChat active={false} />);
    });

    // Wait past the exit animation; the frozen chat cannot commit its unmount.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sheet()).toBeNull();
  });

  it("hides an open sheet while its chat is hidden and restores it on return", async () => {
    flushSync(() => root.render(<SheetInRetainedChat active />));
    await expect.poll(() => sheet()?.textContent).toContain("Models");

    flushSync(() => root.render(<SheetInRetainedChat active={false} />));
    await expect.poll(() => sheet()).toBeNull();

    flushSync(() => root.render(<SheetInRetainedChat active />));
    await expect.poll(() => sheet()?.textContent).toContain("Models");
  });
});
