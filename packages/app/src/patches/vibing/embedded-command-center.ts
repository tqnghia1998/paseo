import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { useEmbeddedActiveChat } from "./embedded-targets";
import { isEmbeddedFocusMode } from "./focus-mode";
import {
  getEmbeddedWorkspace,
  getEmbeddedWorkspaceDirectory,
  useEmbeddedWorkspace,
} from "./workspace-boundary";

// Bots binds one worktree: the command center keeps its commands, plugin entries, file search
// and this worktree's agents, but not the project, workspace and sidebar navigation it hides.
import { isBotChatContext } from "./bot-chat-scope";

const EMBEDDED_ROOT_ACTIONS: ReadonlySet<string> = new Set(["settings", "keyboard-shortcuts"]);

export function keepEmbeddedRootActions<Action extends { id: string }>(
  actions: Action[],
): Action[] {
  return isEmbeddedFocusMode
    ? actions.filter((action) => EMBEDDED_ROOT_ACTIONS.has(action.id))
    : actions;
}

interface AgentRow {
  agent: {
    serverId: string;
    workspaceId?: string | null;
    cwd: string;
    labels?: Record<string, string>;
  };
}

/** Agents are limited to the bound worktree, like Bots chat lists; workspaces are not offered. */
export function scopeEmbeddedCommandCenterRows<Workspace, Agent extends AgentRow>(rows: {
  workspaces: Workspace[];
  agents: Agent[];
}): { workspaces: Workspace[]; agents: Agent[] } {
  if (!isEmbeddedFocusMode) return rows;
  const bound = getEmbeddedWorkspace();
  if (!bound) return { workspaces: [], agents: [] };
  const directory = getEmbeddedWorkspaceDirectory();
  return {
    workspaces: [],
    agents: rows.agents.filter(
      ({ agent }) =>
        agent.serverId === bound.serverId &&
        isBotChatContext(agent) &&
        (agent.workspaceId === bound.workspaceId || (!!directory && agent.cwd === directory)),
    ),
  };
}

/** The Bots route names no workspace; the bound worktree stands in for it. */
export function useEmbeddedWorkspaceSelection(
  selection: ActiveWorkspaceSelection | null,
): ActiveWorkspaceSelection | null {
  const bound = useEmbeddedWorkspace();
  if (selection || !isEmbeddedFocusMode || !bound) return selection;
  return { serverId: bound.serverId, workspaceId: bound.workspaceId };
}

/** Chat-scoped commands act on the Bots chat on screen rather than a workspace tab. */
export function useEmbeddedFocusedAgentId(focusedAgentId: string | null): string | null {
  const chat = useEmbeddedActiveChat();
  return isEmbeddedFocusMode ? (chat?.agentId ?? null) : focusedAgentId;
}
