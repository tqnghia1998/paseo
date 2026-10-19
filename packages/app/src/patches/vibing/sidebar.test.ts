import { expect, it, vi } from "vitest";
import type {
  SidebarWorkspacesListResult,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => ({ serverId: "local", workspaceId: "one" }),
  isEmbeddedWorkspaceAllowed: (serverId: string, workspaceId: string) =>
    serverId === "local" && workspaceId === "one",
}));
import { isEmbeddedScheduleAllowed, scopeEmbeddedSidebarList } from "./sidebar";

function placement(serverId: string, workspaceId: string): SidebarWorkspacePlacement {
  return {
    serverId,
    workspaceId,
    workspaceKey: `${serverId}:${workspaceId}`,
    projectViewKey: "repo",
    projectName: "Repo",
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceId,
  };
}
const workspaces = [
  placement("local", "one"),
  placement("local", "two"),
  placement("remote", "one"),
];
const list: SidebarWorkspacesListResult = {
  workspacePlacements: workspaces,
  projects: [
    {
      viewKey: "repo",
      projectName: "Repo",
      projectKind: "git",
      iconWorkingDir: "/repo",
      hosts: ["local", "remote"].map((serverId) => ({
        serverId,
        projectId: "repo",
        iconWorkingDir: "/repo",
        worktreeSupport: "supported",
      })),
      workspaces,
    },
  ],
  projectNamesByViewKey: new Map([["repo", "Repo"]]),
  isLoading: false,
  isInitialLoad: false,
  isRevalidating: false,
  refreshAll: vi.fn(),
};

it("scopes project rows, hosts, workspaces and shortcut inputs to the bound worktree", () => {
  const scoped = scopeEmbeddedSidebarList(list);
  expect(scoped.workspacePlacements.map((row) => row.workspaceKey)).toEqual(["local:one"]);
  expect(scoped.projects[0].workspaces.map((row) => row.workspaceKey)).toEqual(["local:one"]);
  expect(scoped.projects[0].hosts.map((host) => host.serverId)).toEqual(["local"]);
  expect(scoped.refreshAll).toBe(list.refreshAll);
  expect(list.workspacePlacements).toHaveLength(3);
});

it("leaves standalone sidebar data untouched", async () => {
  vi.stubEnv("EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS", "false");
  vi.resetModules();
  try {
    expect((await import("./sidebar")).scopeEmbeddedSidebarList(list)).toBe(list);
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

it("only exposes schedules for local agents or local runs in the bound worktree", () => {
  const agents = [
    { id: "own", serverId: "local", workspaceId: "one" },
    { id: "other", serverId: "local", workspaceId: "two" },
  ];
  expect(
    isEmbeddedScheduleAllowed(
      { serverId: "local", target: { type: "agent", agentId: "own" } },
      "/worktree",
      agents,
    ),
  ).toBe(true);
  expect(
    isEmbeddedScheduleAllowed(
      { serverId: "local", target: { type: "agent", agentId: "other" } },
      "/worktree",
      agents,
    ),
  ).toBe(false);
  expect(
    isEmbeddedScheduleAllowed(
      { serverId: "local", target: { type: "agent", agentId: "unknown" } },
      "/worktree",
      agents,
    ),
  ).toBe(false);
  const target = {
    type: "new-agent" as const,
    config: { provider: "codex" as const, cwd: "/worktree" },
  };
  expect(isEmbeddedScheduleAllowed({ serverId: "local", target }, "/worktree", agents)).toBe(true);
  expect(isEmbeddedScheduleAllowed({ serverId: "remote", target }, "/worktree", agents)).toBe(
    false,
  );
  expect(isEmbeddedScheduleAllowed({ serverId: "local", target }, "/sibling", agents)).toBe(false);
  expect(isEmbeddedScheduleAllowed({ serverId: "local", target }, undefined, agents)).toBe(false);
  expect(
    isEmbeddedScheduleAllowed(
      {
        serverId: "local",
        target: { ...target, config: { ...target.config, isolation: "worktree" } },
      },
      "/worktree",
      agents,
    ),
  ).toBe(false);
});
