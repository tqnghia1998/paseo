/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const workspaces = vi.hoisted(() => new Map<string, { workspaceDirectory: string }>());
const openImport = vi.hoisted(() => vi.fn());
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: { local: { workspaces } } }) },
}));
vi.mock("@/stores/session-store-hooks", () => ({
  useWorkspace: (_serverId: string | null, workspaceId: string | null) =>
    workspaceId ? workspaces.get(workspaceId) : null,
}));
vi.mock("@/hooks/use-import-session", () => ({
  useImportSession: () => ({ open: openImport, sheet: "import-sheet" }),
}));
vi.mock("@/hooks/use-agent-history", () => ({ useAgentHistory: vi.fn() }));

beforeEach(() => {
  workspaces.clear();
  openImport.mockClear();
  vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "true");
  vi.resetModules();
  sessionStorage.clear();
  window.name = "paseo-workspace:one";
  history.replaceState(null, "", "/");
});

it("allows shared settings but blocks other workspaces, hosts and project management", async () => {
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one", projectId: "repo" });
  for (const path of [
    "/h/local/workspace/one",
    "/sessions",
    "/schedules",
    "/h/local/plugin/example/surface/home",
    "/h/local/agent/agent-one",
    "/settings",
    "/settings/appearance",
    "/settings/shortcuts",
    "/settings/hosts/local/providers",
    "/settings/hosts/local/agents",
    "/settings/hosts/local/terminals",
    "/settings/hosts/local/projects/repo",
    "/settings/hosts/local/plugins",
    "/settings/hosts/local/plugins/example/config",
    "/settings/hosts/local/plugins/space-app-vibing-theme/customizations",
  ]) {
    expect(boundary.isEmbeddedRouteAllowed(path), path).toBe(true);
  }
  for (const path of [
    "/h/local/workspace/two",
    "/h/remote/workspace/one",
    "/h/remote/plugin/example/surface/home",
    "/h/remote/agent/agent-one",
    "/open-project",
    "/settings/vibing-customizations",
    "/settings/hosts/remote/plugins",
    "/settings/hosts/local/projects",
    "/settings/hosts/local/projects/other",
    "/settings/hosts/local/workspaces",
    "/settings/hosts/local/host",
    "/settings/hosts/local/connections",
  ]) {
    expect(boundary.isEmbeddedRouteAllowed(path), path).toBe(false);
  }
});

it("restores the exact frame's worktree after reloading settings, independently of sibling frames", async () => {
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  history.replaceState(null, "", "/settings/appearance");
  vi.resetModules();
  const reloaded = await import("./workspace-boundary");
  expect(reloaded.getEmbeddedWorkspace()).toEqual({ serverId: "local", workspaceId: "one" });
  window.name = "paseo-workspace:two";
  vi.resetModules();
  const sibling = await import("./workspace-boundary");
  expect(sibling.getEmbeddedWorkspace()).toBeNull();
  sibling.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "two" });
  window.name = "paseo-workspace:one";
  vi.resetModules();
  expect((await import("./workspace-boundary")).getEmbeddedWorkspace()?.workspaceId).toBe("one");
});

it("does not replace a bound worktree through ordinary navigation", async () => {
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "two" });
  expect(boundary.getEmbeddedWorkspace()?.workspaceId).toBe("one");
});

it("resolves direct-route import scope only while its daemon workspace descriptor exists", async () => {
  const boundary = await import("./workspace-boundary");
  expect(boundary.getEmbeddedWorkspaceDirectory()).toBeUndefined();
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  expect(boundary.getEmbeddedWorkspaceDirectory()).toBeUndefined();
  workspaces.set("one", { workspaceDirectory: "/worktree" });
  expect(boundary.getEmbeddedWorkspaceDirectory()).toBe("/worktree");
  workspaces.clear();
  expect(boundary.getEmbeddedWorkspaceDirectory()).toBeUndefined();
});

it.each(["available", "unavailable"])(
  "makes Import available after late folder binding with sessionStorage %s",
  async (storage) => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    if (storage === "unavailable") {
      setItem.mockImplementation(() => {
        throw new Error("sessionStorage unavailable");
      });
    }
    const boundary = await import("./workspace-boundary");
    const { useWorktreeImportSession } = await import("./sidebar-hooks");
    const hook = renderHook(useWorktreeImportSession);
    try {
      expect(hook.result.current.isAvailable).toBe(false);
      expect(hook.result.current.sheet).toBeNull();

      act(() => {
        boundary.bindEmbeddedWorkspace({
          serverId: "local",
          workspaceId: "one",
          directory: "/worktree",
        });
      });

      expect(hook.result.current.isAvailable).toBe(true);
      expect(hook.result.current.sheet).toBe("import-sheet");
      hook.result.current.open();
      expect(openImport).toHaveBeenCalledOnce();
    } finally {
      hook.unmount();
      setItem.mockRestore();
    }
  },
);

it("keeps native safe root commands and withholds project creation, navigation and unresolved import", async () => {
  const boundary = await import("./workspace-boundary");
  for (const id of [
    "history",
    "schedules",
    "settings",
    "keyboard-shortcuts",
    "toggle-left-sidebar",
    "sidebar-grouping",
  ]) {
    expect(boundary.isEmbeddedRootCommandAllowed({ id, importAvailable: false }), id).toBe(true);
  }
  for (const id of ["add-project", "new-workspace", "home"]) {
    expect(boundary.isEmbeddedRootCommandAllowed({ id, importAvailable: true }), id).toBe(false);
  }
  expect(
    boundary.isEmbeddedRootCommandAllowed({ id: "import-session", importAvailable: false }),
  ).toBe(false);
  expect(
    boundary.isEmbeddedRootCommandAllowed({ id: "import-session", importAvailable: true }),
  ).toBe(true);
});

it("leaves standalone Paseo unrestricted", async () => {
  vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "false");
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  expect(boundary.getEmbeddedWorkspace()).toBeNull();
  expect(boundary.isEmbeddedRouteAllowed("/h/remote/workspace/two")).toBe(true);
  expect(boundary.isEmbeddedRootCommandAllowed({ id: "add-project", importAvailable: true })).toBe(
    true,
  );
  expect(
    boundary.isEmbeddedRootCommandAllowed({ id: "new-workspace", importAvailable: true }),
  ).toBe(true);
  expect(boundary.isEmbeddedRootCommandAllowed({ id: "home", importAvailable: true })).toBe(true);
});

it("filters command search to this workspace and rejects unbound agents", async () => {
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  expect(boundary.isEmbeddedWorkspaceAllowed("local", "one")).toBe(true);
  expect(boundary.isEmbeddedWorkspaceAllowed("local", "two")).toBe(false);
  expect(boundary.isEmbeddedWorkspaceAllowed("remote", "one")).toBe(false);
  expect(boundary.isEmbeddedWorkspaceAllowed("local", null)).toBe(false);
});

it("allows daemon-confirmed workspace records for the same directory without admitting sibling worktrees", async () => {
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({
    serverId: "local",
    workspaceId: "one",
    directory: "/repo-worktrees/one",
  });
  workspaces.set("run-one", { workspaceDirectory: "/repo-worktrees/one" });
  workspaces.set("two", { workspaceDirectory: "/repo-worktrees/one-sibling" });
  expect(boundary.isEmbeddedWorkspaceAllowed("local", "run-one")).toBe(true);
  expect(boundary.isEmbeddedRouteAllowed("/h/local/workspace/run-one")).toBe(true);
  expect(boundary.isEmbeddedWorkspaceAllowed("local", "two")).toBe(false);
  expect(boundary.isEmbeddedWorkspaceAllowed("local", "unresolved")).toBe(false);
  expect(boundary.isEmbeddedWorkspaceAllowed("remote", "run-one")).toBe(false);
});
