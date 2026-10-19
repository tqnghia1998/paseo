/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "true");
  vi.resetModules();
  sessionStorage.clear();
  window.name = "paseo-workspace:one";
  history.replaceState(null, "", "/");
});

it("allows shared settings but blocks other workspaces, hosts and project management", async () => {
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  for (const path of [
    "/h/local/workspace/one",
    "/settings",
    "/settings/appearance",
    "/settings/shortcuts",
    "/settings/hosts/local/providers",
    "/settings/hosts/local/agents",
    "/settings/hosts/local/terminals",
    "/settings/hosts/local/plugins",
    "/settings/hosts/local/plugins/example/config",
  ]) {
    expect(boundary.isEmbeddedRouteAllowed(path), path).toBe(true);
  }
  for (const path of [
    "/h/local/workspace/two",
    "/h/remote/workspace/one",
    "/open-project",
    "/sessions",
    "/schedules",
    "/settings/hosts/remote/plugins",
    "/settings/hosts/local/projects",
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

it("leaves standalone Paseo unrestricted", async () => {
  vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "false");
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  expect(boundary.getEmbeddedWorkspace()).toBeNull();
  expect(boundary.isEmbeddedRouteAllowed("/h/remote/workspace/two")).toBe(true);
});

it("filters command search to this workspace and rejects unbound agents", async () => {
  const boundary = await import("./workspace-boundary");
  boundary.bindEmbeddedWorkspace({ serverId: "local", workspaceId: "one" });
  expect(boundary.isEmbeddedWorkspaceAllowed("local", "one")).toBe(true);
  expect(boundary.isEmbeddedWorkspaceAllowed("local", "two")).toBe(false);
  expect(boundary.isEmbeddedWorkspaceAllowed("remote", "one")).toBe(false);
  expect(boundary.isEmbeddedWorkspaceAllowed("local", null)).toBe(false);
});
