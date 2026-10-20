import { expect, it } from "vitest";
import { resolveEmbeddedToolEntryRoute } from "./embedded-tools";
it("always opens embedded folder launches in Bots", () => {
  expect(resolveEmbeddedToolEntryRoute("host")).toBe(
    "/h/host/plugin/paseo-bots/sidebar/bots?view=bots",
  );
});
