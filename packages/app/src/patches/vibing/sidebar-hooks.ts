import { useEffect, useMemo } from "react";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useImportSession } from "@/hooks/use-import-session";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useWorkspace } from "@/stores/session-store-hooks";
import {
  getEmbeddedWorkspace,
  getEmbeddedWorkspaceDirectory,
  isEmbeddedWorkspaceAllowed,
  useEmbeddedWorkspace,
} from "./workspace-boundary";
import { isEmbeddedFocusMode } from "./focus-mode";

export function useWorktreeImportSession() {
  const bound = useEmbeddedWorkspace();
  const workspace = useWorkspace(bound?.serverId ?? null, bound?.workspaceId ?? null);
  const cwd = bound?.directory ?? workspace?.workspaceDirectory;
  const isAvailable = !isEmbeddedFocusMode || Boolean(bound && cwd);
  const importSession = useImportSession({
    serverId: bound?.serverId,
    workspaceId: bound?.workspaceId,
    cwd,
    allowShowAllDirectories: !isEmbeddedFocusMode,
  });
  const open = useStableEvent(() => {
    if (!isAvailable) return;
    if (isEmbeddedFocusMode) {
      const current = getEmbeddedWorkspace();
      const sameBinding =
        current?.serverId === bound?.serverId && current?.workspaceId === bound?.workspaceId;
      if (!sameBinding || getEmbeddedWorkspaceDirectory() !== cwd) return;
    }
    importSession.open();
  });
  return { open, sheet: isAvailable ? importSession.sheet : null, isAvailable };
}

export function useWorktreeHistory(options: { serverId: string | null; search: string }) {
  const bound = getEmbeddedWorkspace();
  const history = useAgentHistory({ ...options, serverId: bound?.serverId ?? options.serverId });
  const agents = useMemo(
    () =>
      history.agents.filter((agent) =>
        isEmbeddedWorkspaceAllowed(agent.serverId, agent.workspaceId),
      ),
    [history.agents],
  );
  // An older page may contain only sibling-worktree sessions. Continue until a
  // matching page arrives or the server reports exhaustion/error.
  const findingWorktree = Boolean(bound && !agents.length && history.hasMore && !history.isError);
  const { isLoadingMore, loadMore } = history;
  useEffect(() => {
    if (findingWorktree && !isLoadingMore) loadMore();
  }, [findingWorktree, isLoadingMore, loadMore]);
  return { ...history, agents, isInitialLoad: history.isInitialLoad || findingWorktree };
}
