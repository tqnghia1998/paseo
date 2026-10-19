import { existsSync } from "node:fs";
import path from "node:path";
import type express from "express";
import type { Logger } from "pino";
import type { AgentManager } from "../../server/agent/agent-manager.js";
import type { AgentStorage } from "../../server/agent/agent-storage.js";
import type { WorkspaceRegistry } from "../../server/workspace-registry.js";
import { getRunningWorktreePaths } from "./worktree-activity.js";

interface WorktreeServices {
  agentManager: Pick<AgentManager, "listAgents" | "closeAgent" | "flush" | "deleteAgentState">;
  agentStorage: Pick<AgentStorage, "list" | "beginDelete" | "remove">;
  workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  archiveWorkspace: (workspaceId: string, requestId: string) => Promise<unknown>;
}

export async function pruneMissingWorktreeAgents(
  agentStorage: Pick<AgentStorage, "list" | "remove">,
): Promise<number> {
  const missingAgentIds = (await agentStorage.list())
    .filter((agent) => !existsSync(agent.cwd))
    .map((agent) => agent.id);
  await Promise.all(missingAgentIds.map((agentId) => agentStorage.remove(agentId)));
  return missingAgentIds.length;
}

export async function archiveMissingWorkspaces(
  workspaceRegistry: Pick<WorkspaceRegistry, "list" | "archive">,
): Promise<void> {
  const missingWorkspaceIds = (await workspaceRegistry.list())
    .filter(
      (workspace) => !workspace.archivedAt && !existsSync(workspace.worktreeRoot ?? workspace.cwd),
    )
    .map((workspace) => workspace.workspaceId);
  await Promise.all(
    missingWorkspaceIds.map((workspaceId) =>
      workspaceRegistry.archive(workspaceId, new Date().toISOString()),
    ),
  );
}

// Run before deleting external worktrees so saved agents cannot resume in a missing directory.
export function createWorktreeCleanup(services: WorktreeServices) {
  const { agentManager, agentStorage, workspaceRegistry, archiveWorkspace } = services;
  return async (paths: string[]): Promise<void> => {
    const roots = [...new Set(paths.map((targetPath) => path.resolve(targetPath)))];
    const isInDeletedWorktree = (candidatePath: string) =>
      roots.some(
        (root) => candidatePath === root || candidatePath.startsWith(`${root}${path.sep}`),
      );
    const workspaces = (await workspaceRegistry.list()).filter(
      (workspace) =>
        !workspace.archivedAt && isInDeletedWorktree(workspace.worktreeRoot ?? workspace.cwd),
    );
    const agentIds = new Set([
      ...agentManager
        .listAgents()
        .filter((agent) => isInDeletedWorktree(agent.cwd))
        .map((agent) => agent.id),
      ...(await agentStorage.list())
        .filter((agent) => isInDeletedWorktree(agent.cwd))
        .map((agent) => agent.id),
    ]);

    for (const agentId of agentIds) {
      agentStorage.beginDelete(agentId);
    }
    await Promise.all(
      workspaces.map((workspace) =>
        archiveWorkspace(workspace.workspaceId, "embedded-worktree-cleanup"),
      ),
    );
    await Promise.all(
      [...agentIds].map((agentId) => agentManager.closeAgent(agentId).catch(() => undefined)),
    );
    await agentManager.flush();
    await Promise.all(
      [...agentIds].map(async (agentId) => {
        await agentStorage.remove(agentId);
        await agentManager.deleteAgentState(agentId);
      }),
    );
  };
}

interface WorktreeRoutesInput {
  app: express.Express;
  token: string | undefined;
  logger: Logger;
  agentManager: Pick<AgentManager, "listAgents">;
  workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  cleanupWorktrees: (paths: string[]) => Promise<void>;
}

export function registerWorktreeRoutes(input: WorktreeRoutesInput): void {
  const { app, token, logger, agentManager, workspaceRegistry, cleanupWorktrees } = input;
  const handleWorktreeCleanup = async (req: express.Request, res: express.Response) => {
    const isLoopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    );
    const paths = req.body?.paths;
    if (!token || !isLoopback || req.header("x-paseo-worktree-cleanup-token") !== token) {
      res.status(403).end();
      return;
    }
    if (
      !Array.isArray(paths) ||
      paths.some((targetPath) => typeof targetPath !== "string" || !path.isAbsolute(targetPath))
    ) {
      res.status(400).json({ error: "paths must be absolute strings" });
      return;
    }
    try {
      await cleanupWorktrees(paths);
      res.status(204).end();
    } catch (error) {
      logger.warn({ err: error }, "Failed to clean deleted worktree state");
      res.status(500).json({ error: "Failed to clean deleted worktree state" });
    }
  };
  app.post("/api/worktrees/cleanup", (req, res, next) => {
    void (async () => {
      try {
        await handleWorktreeCleanup(req, res);
      } catch (error) {
        next(error);
      }
    })();
  });
  app.get("/api/worktrees/activity", (req, res, next) => {
    const isLoopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    );
    if (!token || !isLoopback || req.header("x-paseo-worktree-cleanup-token") !== token) {
      res.status(403).end();
      return;
    }
    void (async () => {
      try {
        const workspaces = await workspaceRegistry.list();
        res.json({ runningPaths: getRunningWorktreePaths(agentManager.listAgents(), workspaces) });
      } catch (error) {
        next(error);
      }
    })();
  });
}
