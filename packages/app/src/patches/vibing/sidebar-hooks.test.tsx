/** @vitest-environment jsdom */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  history: {
    agents: [{ id: "sibling", serverId: "local", workspaceId: "two" }],
    hasMore: true,
    isError: false,
    isLoadingMore: false,
    isInitialLoad: false,
    loadMore: vi.fn(),
  },
  historyOptions: vi.fn(),
  importOptions: vi.fn(),
}));
vi.mock("@/hooks/use-agent-history", () => ({
  useAgentHistory: (options: unknown) => {
    fake.historyOptions(options);
    return fake.history;
  },
}));
vi.mock("@/hooks/use-import-session", () => ({
  useImportSession: (options: unknown) => {
    fake.importOptions(options);
    return {};
  },
}));
vi.mock("@/stores/session-store-hooks", () => ({
  useWorkspace: () => ({ workspaceDirectory: "/worktree" }),
}));
vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => ({ serverId: "local", workspaceId: "one" }),
  isEmbeddedWorkspaceAllowed: (serverId: string, workspaceId: string) =>
    serverId === "local" && workspaceId === "one",
}));
import { useWorktreeHistory, useWorktreeImportSession } from "./sidebar-hooks";
afterEach(cleanup);

it("pages past sibling sessions, stops on errors, and displays a matching page", () => {
  const hook = renderHook(() => useWorktreeHistory({ serverId: "remote", search: "task" }));
  expect(fake.historyOptions).toHaveBeenLastCalledWith({ serverId: "local", search: "task" });
  expect(hook.result.current.agents).toEqual([]);
  expect(hook.result.current.isInitialLoad).toBe(true);
  expect(fake.history.loadMore).toHaveBeenCalledOnce();
  fake.history.isError = true;
  hook.rerender();
  expect(hook.result.current.isInitialLoad).toBe(false);
  expect(fake.history.loadMore).toHaveBeenCalledOnce();
  fake.history.isError = false;
  fake.history.agents = [{ id: "own", serverId: "local", workspaceId: "one" }];
  hook.rerender();
  expect(hook.result.current.agents.map((agent) => agent.id)).toEqual(["own"]);
  expect(fake.history.loadMore).toHaveBeenCalledOnce();
});

it("imports only into the bound worktree without offering other directories", () => {
  renderHook(useWorktreeImportSession);
  expect(fake.importOptions).toHaveBeenLastCalledWith({
    serverId: "local",
    workspaceId: "one",
    cwd: "/worktree",
    allowShowAllDirectories: false,
  });
});
