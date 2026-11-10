import { expect, it } from "vitest";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import pino from "pino";
import type { AgentManager } from "../../server/agent/agent-manager.js";
import type { WorkspaceRegistry } from "../../server/workspace-registry.js";
import { registerWorktreeRoutes } from "./worktree-runtime.js";
import { getRunningWorktreePaths } from "./worktree-activity.js";

it("reports live worktree activity without a connected workspace iframe", () => {
  const agents = [
    {
      id: "agent-1",
      cwd: "/repo/src",
      workspaceId: "ws",
      lifecycle: "running",
      activeTurnId: "turn",
    },
    { id: "agent-2", cwd: "/idle", lifecycle: "idle", activeTurnId: null },
    { id: "agent-3", cwd: "/legacy", lifecycle: "idle", activeTurnId: "still-open" },
    { id: "agent-4", cwd: "/helper", lifecycle: "running", activeTurnId: "hidden", internal: true },
    {
      id: "agent-5",
      cwd: "/repo",
      workspaceId: "ws",
      lifecycle: "running",
      activeTurnId: "second",
    },
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
        {
          id: "agent-6",
          cwd: "/repo",
          workspaceId: "ws",
          lifecycle: "running",
          activeTurnId: "turn",
        },
        { id: "agent-7", cwd: "/idle", lifecycle: "idle", activeTurnId: null },
      ],
      [{ workspaceId: "ws", cwd: "/repo", worktreeRoot: null, archivedAt: "2026-10-12" }],
    ),
  ).toEqual([]);
});

it("reports background work and provider subagents after their parent turn ends", () => {
  const agents = [
    {
      id: "parent",
      cwd: "/repo/nested",
      workspaceId: "feature",
      lifecycle: "idle",
      activeTurnId: null,
    },
    { id: "sibling", cwd: "/other", lifecycle: "idle", activeTurnId: null },
    { id: "internal", cwd: "/hidden", lifecycle: "idle", activeTurnId: null, internal: true },
  ] as const;
  const workspaces = [
    { workspaceId: "feature", cwd: "/repo", worktreeRoot: "/repo", archivedAt: null },
  ];
  const working = new Set(["parent", "internal"]);
  const snapshot = () => getRunningWorktreePaths(agents, workspaces, (id) => working.has(id));
  expect(snapshot()).toEqual(["/repo"]);
  working.delete("parent");
  expect(snapshot()).toEqual([]);
  working.add("sibling");
  expect(snapshot()).toEqual(["/other"]);
});

it("serves background and nested provider activity without any iframe connected", async () => {
  let backgroundCount = 0;
  let children: ReturnType<AgentManager["listProviderSubagentActivity"]> = [];
  const parent = {
    id: "parent",
    cwd: "/repo/src",
    workspaceId: "ws",
    lifecycle: "idle",
    activeTurnId: null,
  };
  const app = express();
  registerWorktreeRoutes({
    app,
    token: "test-token",
    logger: pino({ enabled: false }),
    agentManager: {
      listAgents: () => [parent] as ReturnType<AgentManager["listAgents"]>,
      getAgentBackgroundWorkSummary: () =>
        backgroundCount ? { count: backgroundCount } : undefined,
      listProviderSubagentActivity: () => children,
    },
    workspaceRegistry: {
      listAll: async () =>
        [{ workspaceId: "ws", cwd: "/repo", worktreeRoot: "/repo", archivedAt: null }] as Awaited<
          ReturnType<WorkspaceRegistry["listAll"]>
        >,
    },
    cleanupWorktrees: async () => {},
    stopWorktrees: async () => {},
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/worktrees/activity`;
  const read = async () => {
    const response = await fetch(url, {
      headers: { "x-paseo-worktree-cleanup-token": "test-token" },
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  const child = (
    id: string,
    status: "running" | "completed" | "failed",
    parentAgentId = "parent",
  ) =>
    ({
      id,
      parentAgentId,
      parentSubagentId: id === "nested" ? "first" : null,
      status,
    }) as ReturnType<AgentManager["listProviderSubagentActivity"]>[number];
  try {
    expect(await read()).toEqual({ runningPaths: [] });
    backgroundCount = 1;
    expect(await read()).toEqual({ runningPaths: ["/repo"] });
    backgroundCount = 0;
    children = [child("first", "running"), child("nested", "running")];
    expect(await read()).toEqual({ runningPaths: ["/repo"] });
    children = [child("first", "completed"), child("nested", "running")];
    expect(await read()).toEqual({ runningPaths: ["/repo"] });
    children = [
      child("first", "completed"),
      child("nested", "failed"),
      child("unrelated", "running", "other"),
    ];
    expect(await read()).toEqual({ runningPaths: [] });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
