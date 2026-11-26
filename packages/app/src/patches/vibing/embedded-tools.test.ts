import { expect, it } from "vitest";
import { resolveEmbeddedTasksEntryRoute, resolveEmbeddedToolEntryRoute } from "./embedded-tools";

it("always opens embedded folder launches in Bots", () => {
  expect(resolveEmbeddedToolEntryRoute("host")).toBe(
    "/h/host/plugin/paseo-bots/sidebar/bots?view=bots",
  );
});

it("resolves the embedded Tasks board entry to Better Paseo's tasks surface", () => {
  expect(resolveEmbeddedTasksEntryRoute("host")).toBe(
    "/h/host/plugin/better-paseo/surface/tasks?view=tasks",
  );
});
