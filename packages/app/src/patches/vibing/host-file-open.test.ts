// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ origin: "http://127.0.0.1:5173" as string | null }));
vi.mock("./host-messages", () => ({ getEmbeddedHostOrigin: () => host.origin }));

import { openFileInHost, worktreeRelativePath } from "./host-file-open";

describe("worktreeRelativePath", () => {
  it("keeps relative paths and maps absolute paths inside the worktree", () => {
    expect(worktreeRelativePath("src/app.ts", "/repo")).toBe("src/app.ts");
    expect(worktreeRelativePath("./src/app.ts", "/repo")).toBe("src/app.ts");
    expect(worktreeRelativePath("/repo/src/app.ts", "/repo")).toBe("src/app.ts");
    expect(worktreeRelativePath("/repo/src/app.ts", "/repo/")).toBe("src/app.ts");
  });

  it("rejects files outside the worktree", () => {
    expect(worktreeRelativePath("/repo-other/a.ts", "/repo")).toBeNull();
    expect(worktreeRelativePath("/etc/hosts", "/repo")).toBeNull();
    expect(worktreeRelativePath("../a.ts", "/repo")).toBeNull();
    expect(worktreeRelativePath("src/../../a.ts", "/repo")).toBeNull();
    expect(worktreeRelativePath("/repo", "/repo")).toBeNull();
    expect(worktreeRelativePath("/repo/a.ts", "")).toBeNull();
  });
});

describe("openFileInHost", () => {
  afterEach(() => {
    host.origin = "http://127.0.0.1:5173";
    vi.restoreAllMocks();
  });

  it("asks the embedding host to open the worktree file at its line", () => {
    const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    expect(openFileInHost({ path: "/repo/src/app.ts", lineStart: 12, lineEnd: 14 }, "/repo")).toBe(
      true,
    );
    expect(post).toHaveBeenCalledWith(
      { type: "paseo:open-file", path: "src/app.ts", line: 12 },
      "http://127.0.0.1:5173",
    );
    openFileInHost({ path: "README.md" }, "/repo");
    expect(post).toHaveBeenLastCalledWith(
      { type: "paseo:open-file", path: "README.md", line: 1 },
      "http://127.0.0.1:5173",
    );
  });

  it("sends nothing outside an embedding host or the worktree", () => {
    const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    expect(openFileInHost({ path: "/etc/hosts" }, "/repo")).toBe(false);
    host.origin = null;
    expect(openFileInHost({ path: "src/app.ts" }, "/repo")).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});
