import { expect, it } from "vitest";
import { getRunningWorktreePaths } from "./worktree-activity.js";

it("reports live worktree activity without a connected workspace iframe", () => {
  const agents = [
    { cwd: "/repo/src", workspaceId: "ws", lifecycle: "running", activeTurnId: "turn" },
    { cwd: "/idle", lifecycle: "idle", activeTurnId: null },
    { cwd: "/legacy", lifecycle: "idle", activeTurnId: "still-open" },
    { cwd: "/helper", lifecycle: "running", activeTurnId: "hidden", internal: true },
    { cwd: "/repo", workspaceId: "ws", lifecycle: "running", activeTurnId: "second" },
  ] as const;
  expect(
    getRunningWorktreePaths(agents, [
      { workspaceId: "ws", cwd: "/repo", worktreeRoot: "/repo", archivedAt: null },
    ]),
  ).toEqual(["/repo", "/legacy"]);
});

it("does not report idle agents or agents owned by an archived workspace", () => {
  expect(
    getRunningWorktreePaths(
      [
        { cwd: "/repo", workspaceId: "ws", lifecycle: "running", activeTurnId: "turn" },
        { cwd: "/idle", lifecycle: "idle", activeTurnId: null },
      ],
      [{ workspaceId: "ws", cwd: "/repo", worktreeRoot: null, archivedAt: "2026-10-12" }],
    ),
  ).toEqual([]);
});
