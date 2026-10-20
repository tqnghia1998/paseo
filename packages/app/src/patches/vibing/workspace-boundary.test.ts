/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";

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

it("keeps the dedicated Bots tool in Bots and restores it after a settings reload", async () => {
  window.name = "paseo-workspace:bots:/repo";
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  expect(boundary.embeddedWorkspaceRoute()).toBe(
    "/h/local/plugin/paseo-bots/sidebar/bots?view=bots",
  );
  expect(boundary.isEmbeddedRouteAllowed("/h/local/plugin/paseo-bots/sidebar/bots")).toBe(true);
  expect(boundary.isEmbeddedRouteAllowed("/h/local/workspace/one")).toBe(false);
  expect(boundary.isEmbeddedRouteAllowed("/h/local/agent/chat")).toBe(false);
  history.replaceState(null, "", "/settings/appearance");
  vi.resetModules();
  const reloaded = await import("./workspace-boundary");
  expect(reloaded.embeddedWorkspaceRoute()).toBe(
    "/h/local/plugin/paseo-bots/sidebar/bots?view=bots",
  );
});

it("allows shared settings but blocks other workspaces, hosts and project management", async () => {
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one", projectId: "repo" });
  for (const path of [
    "/h/local/plugin/example/surface/home",
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
    "/h/local/workspace/one",
    "/h/local/agent/agent-one",
    "/sessions",
    "/schedules",
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

it("navigates back to Bots when Settings requests the bound workspace", async () => {
  const replace = vi.fn();
  vi.doMock("expo-router", () => ({
    router: { replace },
    useLocalSearchParams: vi.fn(),
    usePathname: vi.fn(),
  }));
  vi.doMock("@/stores/workspace-layout-store", () => ({ useWorkspaceLayoutStore: {} }));
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  const { navigateToLastWorkspace } = await import("@/stores/navigation-active-workspace-store");
  expect(navigateToLastWorkspace()).toBe(true);
  expect(replace).toHaveBeenCalledWith("/h/local/plugin/paseo-bots/sidebar/bots?view=bots");
});
