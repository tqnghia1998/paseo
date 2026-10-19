import { bindEmbeddedWorkspace } from "./workspace-boundary";
import { useEffect } from "react";
import { useRouter, type Href } from "expo-router";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { preserveEmbeddedLiveDesignMessagingQuery } from "./focus-mode";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  normalizeWorkspaceDescriptor,
  useSessionStore,
  type WorkspaceDescriptor,
} from "@/stores/session-store";

export async function openFolderWorkspace(input: {
  folderPath: string;
  client: Pick<DaemonClient, "openProject">;
}): Promise<WorkspaceDescriptor | null> {
  const response = await input.client.openProject(input.folderPath);
  return response.workspace && !response.error
    ? normalizeWorkspaceDescriptor(response.workspace)
    : null;
}

function getFolderParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

interface FolderWorkspaceLaunchInput {
  folder: string | string[] | undefined;
  embeddedLiveDesignMessaging: boolean;
  targetServerId: string | null;
}

export function useEmbeddedFolderWorkspace(input: FolderWorkspaceLaunchInput): string | null {
  const { folder, embeddedLiveDesignMessaging, targetServerId } = input;
  const folderParam = getFolderParam(folder);
  const router = useRouter();
  const client = useHostRuntimeClient(targetServerId ?? "");

  useEffect(() => {
    if (!folderParam || !targetServerId || !client) return;

    const serverId = targetServerId;
    const folderPath = folderParam;
    const currentClient = client;
    let cancelled = false;

    async function handleFolderLaunch() {
      try {
        const workspace = await openFolderWorkspace({
          folderPath,
          client: currentClient,
        });
        if (cancelled || !workspace) return;

        bindEmbeddedWorkspace({
          serverId,
          workspaceId: workspace.id,
          directory: workspace.workspaceDirectory,
          projectId: workspace.projectId,
        });
        useSessionStore.getState().mergeWorkspaces(serverId, [workspace]);
        router.replace(
          preserveEmbeddedLiveDesignMessagingQuery(
            buildHostWorkspaceRoute(serverId, workspace.id),
            embeddedLiveDesignMessaging,
          ) as Href,
        );
      } catch (err) {
        console.error("Failed to open workspace for folder param:", err);
      }
    }

    handleFolderLaunch();

    return () => {
      cancelled = true;
    };
  }, [client, embeddedLiveDesignMessaging, folderParam, router, targetServerId]);

  return folderParam;
}
