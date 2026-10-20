import { expect, it } from "vitest";
import {
  preserveEmbeddedLiveDesignMessagingQuery,
  shouldUseEmbeddedLiveDesignMessaging,
} from "./focus-mode";
it("keeps Live Design on the Bots entry without a second query delimiter", () => {
  expect(preserveEmbeddedLiveDesignMessagingQuery("/bots?view=bots", true)).toBe(
    "/bots?view=bots&embedded-live-design=1",
  );
  expect(shouldUseEmbeddedLiveDesignMessaging(true, "?view=bots&embedded-live-design=1")).toBe(
    true,
  );
  expect(shouldUseEmbeddedLiveDesignMessaging(false, "?embedded-live-design=1")).toBe(false);
});
