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

const makeAgent = (
  id: string,
  serverId: string,
  workspaceId: string | null,
  cwd: string,
  labels?: Record<string, string>,
) => ({
  id,
  serverId,
  workspaceId,
  cwd,
  labels,
});
const agents = [
  makeAgent("bound", "host", "ws", "/repo"),
  makeAgent("same-folder", "host", "legacy-duplicate", "/repo"),
  makeAgent("other-worktree", "host", "other", "/repo-feature"),
  makeAgent("other-host", "remote", "ws", "/repo"),
  makeAgent("design", "host", "ws", "/repo", { "paseo-bots.context": "live-design" }),
];
const workspace = (serverId: string, workspaceId: string) => ({
  serverId,
  workspaceId,
  run: vi.fn(),
  openAgent: vi.fn(),
  agents: agents.filter(
    (agent) => agent.serverId === serverId && agent.workspaceId === workspaceId,
  ),
});
const rows = () => ({
  active: [
    workspace("host", "ws"),
    workspace("host", "legacy-duplicate"),
    workspace("host", "other"),
    workspace("remote", "ws"),
  ],
  archived: [workspace("host", "archived")],
  loading: false,
});

it("keeps current-surface chats under the bound worktree and opens a chat instead of workspace navigation", () => {
  const input = rows();
  const result = scopeEmbeddedCommandCenterRows(input, agents);
  expect(result.active).toHaveLength(1);
  expect(result.archived).toEqual([]);
  expect(result.active[0].agents.map((agent) => agent.id)).toEqual(["bound", "same-folder"]);
  result.active[0].run();
  expect(input.active[0].openAgent).toHaveBeenCalledWith("bound");
  expect(input.active[0].run).not.toHaveBeenCalled();
});

it("offers no navigation before binding or without matching chats", () => {
  bound.workspace = null;
  expect(scopeEmbeddedCommandCenterRows(rows(), agents)).toMatchObject({
    active: [],
    archived: [],
  });
  bound.workspace = { serverId: "host", workspaceId: "ws" };
  expect(scopeEmbeddedCommandCenterRows(rows(), [])).toMatchObject({ active: [], archived: [] });
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

it("keeps Live Design search within its chat context", () => {
  bound.liveDesign = true;
  const result = scopeEmbeddedCommandCenterRows(rows(), agents);
  expect(result.active[0].agents.map((agent) => agent.id)).toEqual(["design"]);
});
