/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
import { createEmbeddedFileRecovery } from "./file-recovery";

const identity = { serverId: "s", workspaceId: "w", tabId: "t", cwd: "/repo", path: "file.ts" };
const draft = {
  file: {
    content: "base",
    hasBom: true,
    version: {
      status: "ready" as const,
      cwd: "/repo",
      path: "file.ts",
      size: 4,
      modifiedAt: "today",
    },
  },
  content: "draft\r\n",
};
beforeEach(() => window.sessionStorage.clear());
it("restores a panel draft without sharing it with other tabs or workspaces", () => {
  createEmbeddedFileRecovery(identity)!.write(draft);
  expect(createEmbeddedFileRecovery(identity)!.read()).toEqual(draft);
  expect(createEmbeddedFileRecovery({ ...identity, tabId: "other" })!.read()).toBeNull();
  expect(createEmbeddedFileRecovery({ ...identity, workspaceId: "other" })!.read()).toBeNull();
  createEmbeddedFileRecovery(identity)!.write(null);
  expect(createEmbeddedFileRecovery(identity)!.read()).toBeNull();
});
it("reports quota failures instead of silently accepting an unprotected edit", () => {
  const storage = {
    getItem: () => null,
    removeItem: () => {},
    setItem: () => {
      throw new Error("quota");
    },
  };
  expect(() => createEmbeddedFileRecovery(identity, storage)!.write(draft)).toThrow(
    "was not accepted",
  );
});
