import { access } from "node:fs/promises";
import path from "node:path";
import { isRealpathInsideRoot } from "../../utils/path.js";
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

async function isMissingPath(target: string): Promise<boolean> {
  try {
    await access(target);
    return false;
  } catch {
    return true;
  }
}

export async function pruneMissingWorktreeAgents(
  agentStorage: Pick<AgentStorage, "list" | "remove">,
): Promise<number> {
  const agents = await agentStorage.list();
  const missing = await Promise.all(agents.map((agent) => isMissingPath(agent.cwd)));
  const missingAgentIds = agents.filter((_, index) => missing[index]).map((agent) => agent.id);
  await Promise.all(missingAgentIds.map((agentId) => agentStorage.remove(agentId)));
  return missingAgentIds.length;
}

export async function archiveMissingWorkspaces(
  workspaceRegistry: Pick<WorkspaceRegistry, "list" | "archive">,
): Promise<void> {
  const workspaces = (await workspaceRegistry.list()).filter((workspace) => !workspace.archivedAt);
  const missing = await Promise.all(
    workspaces.map((workspace) => isMissingPath(workspace.worktreeRoot ?? workspace.cwd)),
  );
  const missingWorkspaceIds = workspaces
    .filter((_, index) => missing[index])
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
      roots.some((root) => isRealpathInsideRoot(root, candidatePath));
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

interface WorktreeStopServices {
  agentManager: {
    listAgents(options: { includeInternal: boolean }): Array<{ id: string; cwd: string }>;
    closeAgent(id: string): Promise<void>;
    flush(): Promise<void>;
  };
  workspaceRegistry: {
    list(): Promise<
      Array<{
        workspaceId: string;
        cwd: string;
        worktreeRoot?: string | null;
        archivedAt?: string | null;
      }>
    >;
  };
  terminalManager: {
    listDirectories(): string[];
    getTerminals(
      cwd: string,
      options: { workspaceId: string },
    ): Promise<Array<{ id: string; workspaceId: string }>>;
    killTerminalAndWait(id: string): Promise<void>;
  };
  stopWorkspaceSetup(workspaceId: string): Promise<void>;
}

// Offload releases runtime ownership without archiving or deleting resumable records.
export function createWorktreeStop(services: WorktreeStopServices) {
  return async (paths: string[]): Promise<void> => {
    const roots = [...new Set(paths.map((root) => path.resolve(root)))];
    const owns = (cwd: string) => roots.some((root) => isRealpathInsideRoot(root, cwd));
    const workspaces = (await services.workspaceRegistry.list()).filter(
      (workspace) => !workspace.archivedAt && owns(workspace.worktreeRoot ?? workspace.cwd),
    );
    await Promise.all(
      workspaces.map((workspace) => services.stopWorkspaceSetup(workspace.workspaceId)),
    );
    const outcomes = await Promise.allSettled([
      ...services.agentManager
        .listAgents({ includeInternal: true })
        .filter((agent) => owns(agent.cwd))
        .map((agent) => services.agentManager.closeAgent(agent.id)),
      ...workspaces.map(async (workspace) => {
        const lists = await Promise.all(
          services.terminalManager
            .listDirectories()
            .map((cwd) =>
              services.terminalManager.getTerminals(cwd, { workspaceId: workspace.workspaceId }),
            ),
        );
        const ids = new Set(
          lists
            .flat()
            .filter((terminal) => terminal.workspaceId === workspace.workspaceId)
            .map((terminal) => terminal.id),
        );
        const stops = await Promise.allSettled(
          [...ids].map((id) => services.terminalManager.killTerminalAndWait(id)),
        );
        const failure = stops.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      }),
    ]);
    await services.agentManager.flush();
    const failure = outcomes.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  };
}

interface WorktreeRoutesInput {
  app: express.Express;
  token: string | undefined;
  logger: Logger;
  agentManager: Pick<AgentManager, "listAgents">;
  workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  cleanupWorktrees: (paths: string[]) => Promise<void>;
  stopWorktrees: (paths: string[]) => Promise<void>;
}

export function registerWorktreeRoutes(input: WorktreeRoutesInput): void {
  const { app, token, logger, agentManager, workspaceRegistry, cleanupWorktrees } = input;
  const handleWorktreeCleanup = async (
    req: express.Request,
    res: express.Response,
    stopOnly: boolean,
  ) => {
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
      await input.stopWorktrees(paths);
      if (!stopOnly) await cleanupWorktrees(paths);
      res.status(204).end();
    } catch (error) {
      logger.warn({ err: error }, "Failed to clean deleted worktree state");
      res.status(500).json({ error: "Failed to clean deleted worktree state" });
    }
  };
  for (const action of ["cleanup", "stop"] as const) {
    app.post(`/api/worktrees/${action}`, (req, res, next) => {
      void (async () => {
        try {
          await handleWorktreeCleanup(req, res, action === "stop");
        } catch (error) {
          next(error);
        }
      })();
    });
  }
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
