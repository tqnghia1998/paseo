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

interface SearchAgent {
  id: string;
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  labels?: Record<string, string>;
}

interface SearchWorkspace {
  serverId: string;
  workspaceId: string;
  agents: readonly { id: string }[];
  run(): void;
  openAgent(agentId: string): void;
}

/** Upstream groups chat matches under workspaces; embedded search opens only this worktree's chats. */
export function scopeEmbeddedCommandCenterRows<Workspace extends SearchWorkspace>(
  rows: { active: Workspace[]; archived: Workspace[]; loading: boolean },
  agents: readonly SearchAgent[],
): { active: Workspace[]; archived: Workspace[]; loading: boolean } {
  if (!isEmbeddedFocusMode) return rows;
  const bound = getEmbeddedWorkspace();
  const workspace = rows.active.find(
    (row) => row.serverId === bound?.serverId && row.workspaceId === bound.workspaceId,
  );
  if (!bound || !workspace) return { ...rows, active: [], archived: [] };
  const directory = getEmbeddedWorkspaceDirectory();
  const allowed = new Set(
    agents
      .filter(
        (agent) =>
          agent.serverId === bound.serverId &&
          isBotChatContext(agent) &&
          (agent.workspaceId === bound.workspaceId || (!!directory && agent.cwd === directory)),
      )
      .map((agent) => agent.id),
  );
  const chats = rows.active.flatMap((row) => row.agents).filter((agent) => allowed.has(agent.id));
  return {
    ...rows,
    active: chats.length
      ? [{ ...workspace, agents: chats, run: () => workspace.openAgent(chats[0].id) }]
      : [],
    archived: [],
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
