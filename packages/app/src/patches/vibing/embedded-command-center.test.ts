import { beforeEach, expect, it, vi } from "vitest";

const bound = vi.hoisted(() => ({
  liveDesign: false,
  workspace: { serverId: "host", workspaceId: "ws" } as {
    serverId: string;
    workspaceId: string;
  } | null,
}));
vi.mock("./focus-mode", () => ({
  isEmbeddedFocusMode: true,
  get isEmbeddedLiveDesignMessaging() {
    return bound.liveDesign;
  },
}));
vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => bound.workspace,
  getEmbeddedWorkspaceDirectory: () => (bound.workspace ? "/repo" : undefined),
  useEmbeddedWorkspace: () => bound.workspace,
}));

import { keepEmbeddedRootActions, scopeEmbeddedCommandCenterRows } from "./embedded-command-center";

beforeEach(() => {
  bound.liveDesign = false;
  bound.workspace = { serverId: "host", workspaceId: "ws" };
});

const agent = (id: string, serverId: string, workspaceId: string | null, cwd: string) => ({
  id,
  agent: { serverId, workspaceId, cwd },
});

it("keeps only the agents of the bound worktree and drops workspace navigation", () => {
  const rows = scopeEmbeddedCommandCenterRows({
    workspaces: [{ id: "workspace:host:other" }],
    agents: [
      agent("bound", "host", "ws", "/repo"),
      agent("same-folder", "host", "legacy-duplicate", "/repo"),
      agent("other-worktree", "host", "other", "/repo-feature"),
      agent("other-host", "remote", "ws", "/repo"),
    ],
  });
  expect(rows.workspaces).toEqual([]);
  expect(rows.agents.map((row) => row.id)).toEqual(["bound", "same-folder"]);
});

it("offers nothing to navigate before the worktree is bound", () => {
  bound.workspace = null;
  const rows = scopeEmbeddedCommandCenterRows({
    workspaces: [{ id: "w" }],
    agents: [agent("a", "host", "ws", "/repo")],
  });
  expect(rows).toEqual({ workspaces: [], agents: [] });
});

it("keeps settings and shortcut help among the root commands", () => {
  const ids = [
    "add-project",
    "new-workspace",
    "import-session",
    "home",
    "history",
    "schedules",
    "settings",
    "toggle-left-sidebar",
    "keyboard-shortcuts",
    "sidebar-grouping",
  ];
  expect(keepEmbeddedRootActions(ids.map((id) => ({ id }))).map((action) => action.id)).toEqual([
    "settings",
    "keyboard-shortcuts",
  ]);
});

it("keeps command-center conversation results in the current surface", () => {
  const normal = agent("normal", "host", "ws", "/repo");
  const design = {
    ...agent("design", "host", "ws", "/repo"),
    agent: { ...normal.agent, labels: { "paseo-bots.context": "live-design" } },
  };
  const rows = { workspaces: [], agents: [normal, design] };
  expect(scopeEmbeddedCommandCenterRows(rows).agents.map((row) => row.id)).toEqual(["normal"]);
  bound.liveDesign = true;
  expect(scopeEmbeddedCommandCenterRows(rows).agents.map((row) => row.id)).toEqual(["design"]);
});
