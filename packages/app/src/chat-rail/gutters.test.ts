import { describe, expect, it } from "vitest";
import { CHAT_OUTLINE_GUTTER_INSET } from "@/agent-stream/chat-outline/geometry";
import { CHAT_COLUMN_BASE_GUTTER, resolveChatColumnGutters } from "./gutters";
import {
  CHAT_COLUMN_RAIL_DATASET as NATIVE_CHAT_COLUMN_RAIL_DATASET,
  ChatColumnRailSurface as NativeChatColumnRailSurface,
  useChatOutlineRail as useNativeChatOutlineRail,
} from "./index.native";
import { CHAT_COLUMN_RAIL_DATASET as WEB_CHAT_COLUMN_RAIL_DATASET } from "./index.web";

describe("resolveChatColumnGutters", () => {
  it("uses symmetric base gutters when no outline inset is reserved", () => {
    expect(
      resolveChatColumnGutters({
        gutter: CHAT_COLUMN_BASE_GUTTER,
        outlineInset: 0,
        contentMaxWidth: 820,
      }),
    ).toEqual({ paddingLeft: 16, paddingRight: 16 });

    expect(
      resolveChatColumnGutters({
        gutter: CHAT_COLUMN_BASE_GUTTER,
        outlineInset: 0,
        contentMaxWidth: undefined,
      }),
    ).toEqual({ paddingLeft: 16, paddingRight: 16 });
  });

  it("mirrors the outline gutter on both sides regardless of content width", () => {
    expect(
      resolveChatColumnGutters({
        gutter: CHAT_COLUMN_BASE_GUTTER,
        outlineInset: CHAT_OUTLINE_GUTTER_INSET,
        contentMaxWidth: undefined,
      }),
    ).toEqual({ paddingLeft: 60, paddingRight: 60 });

    expect(
      resolveChatColumnGutters({
        gutter: CHAT_COLUMN_BASE_GUTTER,
        outlineInset: CHAT_OUTLINE_GUTTER_INSET,
        contentMaxWidth: 820,
      }),
    ).toEqual({ paddingLeft: 60, paddingRight: 60 });

    expect(
      resolveChatColumnGutters({
        gutter: CHAT_COLUMN_BASE_GUTTER,
        outlineInset: CHAT_OUTLINE_GUTTER_INSET,
        contentMaxWidth: 1200,
      }),
    ).toEqual({ paddingLeft: 60, paddingRight: 60 });
  });
});

describe("native and web chat-rail boundaries", () => {
  it("keeps native as a zero-overhead pass-through with no dataset or outline inset", () => {
    const sentinel = "child";
    expect(NATIVE_CHAT_COLUMN_RAIL_DATASET).toBeUndefined();
    expect(useNativeChatOutlineRail()).toEqual({ enabled: false, inset: 0 });
    expect(NativeChatColumnRailSurface({ serverId: "srv-1", children: sentinel })).toBe(sentinel);
  });

  it("tags web rail lanes with a frozen dataset reference", () => {
    expect(WEB_CHAT_COLUMN_RAIL_DATASET).toEqual({ chatRailLane: "true" });
    expect(Object.isFrozen(WEB_CHAT_COLUMN_RAIL_DATASET)).toBe(true);
  });
});
