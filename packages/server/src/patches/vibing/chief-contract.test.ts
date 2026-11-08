import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseChiefSession } from "../../../../app/src/patches/vibing/chief-session.js";
import { BranchName } from "./chief-tools.js";

// The Vibing host runs the identical transport fixture file against its own parser.
const fixtures = JSON.parse(
  readFileSync(
    new URL("../../../../../test-fixtures/vibing-chief-contract.json", import.meta.url),
    "utf8",
  ),
);

test("frame sessions and runtime branches agree with the host contract fixtures", () => {
  for (const entry of fixtures.sessions)
    expect(parseChiefSession(entry.value) !== null, entry.name).toBe(entry.valid);
  for (const entry of fixtures.branches)
    expect(BranchName.safeParse(entry.value).success, entry.value).toBe(entry.valid);
});
