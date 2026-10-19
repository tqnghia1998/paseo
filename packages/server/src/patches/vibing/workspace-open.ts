import type { AgentManager } from "../../server/agent/agent-manager.js";
import type { AgentStorage } from "../../server/agent/agent-storage.js";
import type { PersistedWorkspaceRecord } from "../../server/workspace-registry.js";

interface WorkspaceActivityInput {
  agentStorage: Pick<AgentStorage, "list">;
  agentManager: Pick<AgentManager, "listAgents">;
}
export async function getRecentWorkspaceAgentActivity(
  input: WorkspaceActivityInput,
): Promise<Map<string, Date>> {
  const { agentStorage, agentManager } = input;
  // Merge persisted records (survive restarts, include closed agents) with live
  // agents. agent-projections persists lastActivityAt as agent.updatedAt.
  const activity = new Map<string, Date>();
  const consider = (workspaceId: string | undefined, at: Date | string | null | undefined) => {
    if (!workspaceId || at === null || at === undefined) return;
    const time = typeof at === "string" ? Date.parse(at) : at.getTime();
    if (!Number.isFinite(time)) return;
    const previous = activity.get(workspaceId);
    if (!previous || time > previous.getTime()) {
      activity.set(workspaceId, new Date(time));
    }
  };
  for (const record of await agentStorage.list()) {
    consider(record.workspaceId, record.lastActivityAt ?? record.updatedAt);
  }
  for (const agent of agentManager.listAgents()) {
    consider(agent.workspaceId, agent.updatedAt);
  }
  return activity;
}

// Session instances are per socket; concurrent iframe loads share the same daemon open.
const workspaceOpenByKey = new Map<string, Promise<PersistedWorkspaceRecord>>();
interface CoalescedWorkspaceOpenInput {
  serverId?: string;
  cwd: string;
  open: (cwd: string) => Promise<PersistedWorkspaceRecord>;
}
export async function coalesceWorkspaceOpen(
  input: CoalescedWorkspaceOpenInput,
): Promise<PersistedWorkspaceRecord> {
  const { serverId, cwd, open } = input;
  const key = `${serverId ?? ""}\0${cwd}`;
  const inFlight = workspaceOpenByKey.get(key);
  if (inFlight) return inFlight;
  const pending = open(cwd);
  workspaceOpenByKey.set(key, pending);
  try {
    return await pending;
  } finally {
    if (workspaceOpenByKey.get(key) === pending) workspaceOpenByKey.delete(key);
  }
}

export function preferActiveWorkspaceByAgentActivity(
  workspaces: PersistedWorkspaceRecord[],
  activity: ReadonlyMap<string, Date>,
): PersistedWorkspaceRecord | undefined {
  return workspaces
    .filter((workspace) => !workspace.archivedAt)
    .sort(
      (left, right) =>
        (activity.get(right.workspaceId)?.getTime() ?? 0) -
        (activity.get(left.workspaceId)?.getTime() ?? 0),
    )[0];
}
