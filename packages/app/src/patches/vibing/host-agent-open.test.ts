import { describe, expect, it } from "vitest";
import { shouldUseEmbeddedTasksView } from "./focus-mode";
import { isToggleTasksBoardKeyEvent } from "./host-agent-open";

describe("embedded Tasks board view and shortcuts", () => {
  it("recognizes framed ?view=tasks and named paseo-global:tasks frames only in embedded mode", () => {
    expect(shouldUseEmbeddedTasksView(true, true, "?view=tasks")).toBe(true);
    expect(shouldUseEmbeddedTasksView(true, true, "", "paseo-global:tasks")).toBe(true);
    expect(shouldUseEmbeddedTasksView(false, true, "?view=tasks")).toBe(false);
    expect(shouldUseEmbeddedTasksView(true, false, "?view=tasks")).toBe(false);
    expect(shouldUseEmbeddedTasksView(true, true, "?view=bots")).toBe(false);
  });

  it("matches Mod+B without Shift, Alt, or extra modifiers", () => {
    expect(
      isToggleTasksBoardKeyEvent(
        {
          code: "KeyB",
          key: "b",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          isComposing: false,
        },
        true,
      ),
    ).toBe(true);
    expect(
      isToggleTasksBoardKeyEvent(
        {
          code: "KeyB",
          key: "B",
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
          isComposing: false,
        },
        false,
      ),
    ).toBe(true);
    expect(
      isToggleTasksBoardKeyEvent(
        {
          code: "KeyB",
          key: "b",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
          isComposing: false,
        },
        true,
      ),
    ).toBe(false);
  });
});
