/** @vitest-environment jsdom */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { getEmbeddedWorkspace } from "./workspace-boundary";

interface TestWorkspace {
  workspaceDirectory: string;
}

const fake = vi.hoisted(() => ({
  bound: { serverId: "local", workspaceId: "one" } as ReturnType<typeof getEmbeddedWorkspace>,
  workspace: { workspaceDirectory: "/worktree" } as TestWorkspace | null,
  openImport: vi.fn(),
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
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
vi.mock("@/hooks/use-agent-history", () => ({
  useAgentHistory: (options: unknown) => {
    fake.historyOptions(options);
    return fake.history;
  },
}));
vi.mock("@/hooks/use-import-session", () => ({
  useImportSession: (options: unknown) => {
    fake.importOptions(options);
    return { open: fake.openImport, sheet: "import-sheet" };
  },
}));
vi.mock("@/stores/session-store-hooks", () => ({
  useWorkspace: () => fake.workspace,
}));
vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => fake.bound,
  useEmbeddedWorkspace: () => fake.bound,
  getEmbeddedWorkspaceDirectory: () =>
    fake.bound?.directory ?? (fake.bound ? fake.workspace?.workspaceDirectory : undefined),
  isEmbeddedWorkspaceAllowed: (serverId: string, workspaceId: string) =>
    serverId === "local" && workspaceId === "one",
}));
import { useWorktreeHistory, useWorktreeImportSession } from "./sidebar-hooks";
beforeEach(() => {
  fake.bound = { serverId: "local", workspaceId: "one" };
  fake.workspace = { workspaceDirectory: "/worktree" };
  fake.openImport.mockClear();
});
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
  const hook = renderHook(useWorktreeImportSession);
  expect(fake.importOptions).toHaveBeenLastCalledWith({
    serverId: "local",
    workspaceId: "one",
    cwd: "/worktree",
    allowShowAllDirectories: false,
  });
  expect(hook.result.current.isAvailable).toBe(true);
  expect(hook.result.current.sheet).toBe("import-sheet");
  hook.result.current.open();
  expect(fake.openImport).toHaveBeenCalledOnce();
});

it("withholds import until both the binding and directory have resolved", () => {
  fake.bound = null;
  fake.workspace = null;
  const hook = renderHook(useWorktreeImportSession);
  const savedOpen = hook.result.current.open;
  expect(hook.result.current.isAvailable).toBe(false);
  expect(hook.result.current.sheet).toBeNull();
  savedOpen();
  expect(fake.openImport).not.toHaveBeenCalled();

  fake.bound = { serverId: "local", workspaceId: "one" };
  hook.rerender();
  expect(hook.result.current.isAvailable).toBe(false);
  expect(hook.result.current.sheet).toBeNull();
  savedOpen();
  expect(fake.openImport).not.toHaveBeenCalled();

  fake.workspace = { workspaceDirectory: "/worktree" };
  hook.rerender();
  expect(hook.result.current.isAvailable).toBe(true);
  expect(hook.result.current.sheet).toBe("import-sheet");
  savedOpen();
  expect(fake.openImport).toHaveBeenCalledOnce();
});

it("rejects saved import actions when scope changes before rendering catches up", () => {
  const hook = renderHook(useWorktreeImportSession);
  const savedOpen = hook.result.current.open;
  fake.workspace = { workspaceDirectory: "/other-worktree" };
  savedOpen();
  expect(fake.openImport).not.toHaveBeenCalled();

  fake.workspace = { workspaceDirectory: "/worktree" };
  fake.bound = { serverId: "remote", workspaceId: "one" };
  savedOpen();
  expect(fake.openImport).not.toHaveBeenCalled();

  fake.bound = { serverId: "local", workspaceId: "one" };
  fake.workspace = null;
  savedOpen();
  expect(fake.openImport).not.toHaveBeenCalled();
  hook.rerender();
  expect(hook.result.current.sheet).toBeNull();
  expect(hook.result.current.isAvailable).toBe(false);
});

it("keeps a resolved folder binding scoped while its descriptor reloads", () => {
  fake.bound = { serverId: "local", workspaceId: "one", directory: "/worktree" };
  fake.workspace = null;
  const hook = renderHook(useWorktreeImportSession);
  expect(hook.result.current.isAvailable).toBe(true);
  expect(fake.importOptions).toHaveBeenLastCalledWith({
    serverId: "local",
    workspaceId: "one",
    cwd: "/worktree",
    allowShowAllDirectories: false,
  });
  hook.result.current.open();
  expect(fake.openImport).toHaveBeenCalledOnce();
});

it("keeps native host selection available outside embedded builds", async () => {
  vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "false");
  vi.resetModules();
  fake.bound = null;
  fake.workspace = null;
  try {
    const { useWorktreeImportSession: useStandardImport } = await import("./sidebar-hooks");
    const hook = renderHook(useStandardImport);
    expect(hook.result.current.isAvailable).toBe(true);
    expect(hook.result.current.sheet).toBe("import-sheet");
    expect(fake.importOptions).toHaveBeenLastCalledWith({
      serverId: undefined,
      workspaceId: undefined,
      cwd: undefined,
      allowShowAllDirectories: true,
    });
    hook.result.current.open();
    expect(fake.openImport).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});
