import type { ScheduleSummary } from "@getpaseo/protocol/schedule/types";
import type { SidebarWorkspacesListResult } from "@/hooks/use-sidebar-workspaces-list";
import { isEmbeddedFocusMode } from "./focus-mode";
import { getEmbeddedWorkspace, isEmbeddedWorkspaceAllowed } from "./workspace-boundary";

// Filter before projection so rows, menus, pins and keyboard targets share one scope.
export function scopeEmbeddedSidebarList(
  list: SidebarWorkspacesListResult,
): SidebarWorkspacesListResult {
  if (!isEmbeddedFocusMode) return list;
  const bound = getEmbeddedWorkspace();
  const matches = (row: { serverId: string; workspaceId: string }) =>
    isEmbeddedWorkspaceAllowed(row.serverId, row.workspaceId);
  const projects = list.projects.flatMap((project) => {
    const workspaces = project.workspaces.filter(matches);
    return workspaces.length
      ? [
          {
            ...project,
            workspaces,
            hosts: project.hosts.filter((host) => host.serverId === bound?.serverId),
          },
        ]
      : [];
  });
  return {
    ...list,
    projects,
    workspacePlacements: list.workspacePlacements.filter(matches),
    projectNamesByViewKey: new Map(
      projects.map((project) => [project.viewKey, project.projectName]),
    ),
  };
}

export function isEmbeddedScheduleAllowed(
  schedule: Pick<ScheduleSummary, "target"> & { serverId: string },
  directory: string | undefined,
  agents: readonly { id: string; serverId: string; workspaceId?: string | null }[],
): boolean {
  if (!isEmbeddedFocusMode) return true;
  const bound = getEmbeddedWorkspace();
  if (!bound || schedule.serverId !== bound.serverId) return false;
  if (schedule.target.type === "agent") {
    const agentId = schedule.target.agentId;
    return agents.some(
      (agent) =>
        agent.id === agentId && isEmbeddedWorkspaceAllowed(agent.serverId, agent.workspaceId),
    );
  }
  return Boolean(
    directory &&
    schedule.target.config.cwd === directory &&
    schedule.target.config.isolation !== "worktree",
  );
}
