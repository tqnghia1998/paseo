/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarWorkspaceArea } from "./sidebar-controls";
import type {
  SidebarWorkspacesListResult,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
const ui = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
  return {
    embedded: true,
    bound: { serverId: "local", workspaceId: "one" } as {
      serverId: string;
      workspaceId: string;
    } | null,
  };
});
vi.mock("./focus-mode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./focus-mode")>()),
  get isEmbeddedFocusMode() {
    return ui.embedded;
  },
}));
vi.mock("./workspace-boundary", () => ({
  useEmbeddedWorkspace: () => ui.bound,
  getEmbeddedWorkspace: () => ui.bound,
  isEmbeddedWorkspaceAllowed: (serverId: string, workspaceId: string) =>
    serverId === "local" && workspaceId === "one",
}));

beforeEach(() => {
  vi.stubGlobal("React", React);
  ui.embedded = true;
  ui.bound = { serverId: "local", workspaceId: "one" };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

it("leaves standalone sidebar data untouched", () => {
  ui.embedded = false;
  expect(scopeEmbeddedSidebarList(list)).toBe(list);
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

it("omits workspace rows and setup callouts without mounting them in embedded sidebars", () => {
  const mount = vi.fn();
  function WorkspaceContent() {
    mount();
    return <div>Workspaces and setup</div>;
  }
  const view = render(
    <SidebarWorkspaceArea>
      <WorkspaceContent />
    </SidebarWorkspaceArea>,
  );
  expect(mount).not.toHaveBeenCalled();
  expect(screen.queryByText("Workspaces and setup")).toBeNull();
  ui.embedded = false;
  view.rerender(
    <SidebarWorkspaceArea>
      <WorkspaceContent />
    </SidebarWorkspaceArea>,
  );
  expect(screen.getByText("Workspaces and setup")).toBeDefined();
});
