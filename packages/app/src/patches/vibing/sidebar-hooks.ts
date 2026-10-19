import { useEffect, useMemo } from "react";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useImportSession } from "@/hooks/use-import-session";
import { useWorkspace } from "@/stores/session-store-hooks";
import { getEmbeddedWorkspace, isEmbeddedWorkspaceAllowed } from "./workspace-boundary";

export function useWorktreeImportSession() {
  const bound = getEmbeddedWorkspace();
  const workspace = useWorkspace(bound?.serverId ?? null, bound?.workspaceId ?? null);
  return useImportSession({
    serverId: bound?.serverId,
    workspaceId: bound?.workspaceId,
    cwd: workspace?.workspaceDirectory ?? bound?.directory,
    allowShowAllDirectories: !bound,
  });
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
