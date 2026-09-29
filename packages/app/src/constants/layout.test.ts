import { describe, expect, it } from "vitest";
import { CHAT_HORIZONTAL_SPACING, CHAT_WIDE_MIN_WIDTH, getChatHorizontalSpacing } from "./layout";

describe("chat horizontal spacing", () => {
  it.each([320, 768, 918, 959])("uses compact gutters below the boundary at %i", (width) => {
    expect(getChatHorizontalSpacing(width < CHAT_WIDE_MIN_WIDTH)).toBe(4);
  });

  it.each([960, 1024, 1440])("uses the build's wide gutter at %i", (width) => {
    expect(getChatHorizontalSpacing(width < CHAT_WIDE_MIN_WIDTH)).toBe(CHAT_HORIZONTAL_SPACING);
  });
});
