import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentControlTrigger } from "./control";

function TestIcon() {
  return null;
}

function noop() {}

const SHEET_WIDTH = { width: 480 };

describe("AgentControlTrigger sheet rows", () => {
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

  it("spans the sheet so a mode value such as Plan mode is not truncated", () => {
    flushSync(() =>
      root.render(
        <View style={SHEET_WIDTH}>
          <AgentControlTrigger
            icon={TestIcon}
            surface="sheet"
            label="Mode"
            value="Accept file edits"
            onPress={noop}
            accessibilityLabel="Select agent mode (Accept file edits)"
          />
        </View>,
      ),
    );
    const value = Array.from(document.querySelectorAll("div")).find(
      (el) => el.textContent === "Accept file edits" && el.childElementCount === 0,
    );
    expect(value).toBeDefined();
    expect(value!.scrollWidth).toBeLessThanOrEqual(value!.clientWidth);
  });
});
