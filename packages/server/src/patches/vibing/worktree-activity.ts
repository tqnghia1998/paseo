import path from "node:path";
import type { ManagedAgent } from "../../server/agent/agent-manager.js";
import type { PersistedWorkspaceRecord } from "../../server/workspace-registry.js";

export function getRunningWorktreePaths(
  agents: ReadonlyArray<
    Pick<ManagedAgent, "cwd" | "workspaceId" | "lifecycle" | "activeTurnId" | "internal">
  >,
  workspaces: ReadonlyArray<
    Pick<PersistedWorkspaceRecord, "workspaceId" | "cwd" | "worktreeRoot" | "archivedAt">
  >,
): string[] {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  const paths = new Set<string>();
  for (const agent of agents) {
    if (agent.internal || (agent.lifecycle !== "running" && !agent.activeTurnId)) continue;
    const workspace = agent.workspaceId ? workspacesById.get(agent.workspaceId) : undefined;
    if (workspace?.archivedAt) continue;
    paths.add(path.resolve(workspace?.worktreeRoot ?? workspace?.cwd ?? agent.cwd));
  }
  return [...paths];
}
