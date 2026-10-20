import { expect, it } from "vitest";
import { isBotsToolEntry, resolveEmbeddedToolEntryRoute } from "./embedded-tools";

it("opens the dedicated Bots tool directly while retaining normal workspace launches", () => {
  expect(resolveEmbeddedToolEntryRoute("host", "workspace", true)).toBe(
    "/h/host/plugin/paseo-bots/sidebar/bots?view=bots",
  );
  expect(resolveEmbeddedToolEntryRoute("host", "workspace", false)).toBe(
    "/h/host/workspace/workspace",
  );
});

it("recognizes Bots from its distinct iframe identity or an explicit entry query", () => {
  expect(isBotsToolEntry("paseo-workspace:bots:/repo", "")).toBe(true);
  expect(isBotsToolEntry("", "?folder=/repo&view=bots")).toBe(true);
  expect(isBotsToolEntry("paseo-workspace:/repo", "")).toBe(false);
  expect(isBotsToolEntry("paseo-workspace:live-design:/repo", "?embedded-live-design=1")).toBe(
    false,
  );
});
