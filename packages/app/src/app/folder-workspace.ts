import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export function findMatchingWorkspace(
  sessions: Record<string, { workspaces: Map<string, WorkspaceDescriptor> } | undefined>,
  serverId: string,
  target: string,
): WorkspaceDescriptor | null {
  const workspaces = sessions[serverId]?.workspaces;
  if (!workspaces) return null;

  const normalizedTarget = normalizeWorkspacePath(target) ?? target;
  for (const workspace of workspaces.values()) {
    const normalizedDirectory =
      normalizeWorkspacePath(workspace.workspaceDirectory) ?? workspace.workspaceDirectory;
    if (normalizedDirectory === normalizedTarget || workspace.id === target) {
      return workspace;
    }
  }
  return null;
}

export async function openFolderWorkspace(input: {
  sessions: Record<string, { workspaces: Map<string, WorkspaceDescriptor> } | undefined>;
  serverId: string;
  folderPath: string;
  client: Pick<DaemonClient, "openProject">;
}): Promise<WorkspaceDescriptor | null> {
  const existing = findMatchingWorkspace(input.sessions, input.serverId, input.folderPath);
  if (existing) return existing;

  const response = await input.client.openProject(input.folderPath);
  return response.workspace && !response.error
    ? normalizeWorkspaceDescriptor(response.workspace)
    : null;
}
