import React, { useEffect } from "react";
import type { Href } from "expo-router";
import { Redirect, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useEarliestOnlineHostServerId, useHostRuntimeBootstrapState } from "@/app/_layout";
import {
  resolveStartupRoute,
  resolveWorkspaceSelectionStatus,
} from "@/navigation/host-runtime-bootstrap";
import { useHostRegistryStatus, useHosts, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useHasHydratedWorkspaces, useWorkspaceExists } from "@/stores/session-store-hooks";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useSessionStore } from "@/stores/session-store";
import { openFolderWorkspace } from "@/app/folder-workspace";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { usePanelStore } from "@/stores/panel-store";
import { preserveEmbeddedLiveDesignMessagingQuery } from "@/embedded-focus-mode";

const isDesktop = shouldUseDesktopDaemon();

function getFolderParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

export default function Index() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useLocalSearchParams<{ folder?: string; "embedded-live-design"?: string }>();
  const folderParam = getFolderParam(params.folder);
  const embeddedLiveDesignMessaging = params["embedded-live-design"] === "1";

  const bootstrapState = useHostRuntimeBootstrapState();
  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const workspaceSelection = useLastWorkspaceSelection();
  const isWorkspaceSelectionLoaded = useIsLastWorkspaceSelectionHydrated();
  const workspaceSelectionServerId = workspaceSelection?.serverId ?? null;
  const workspaceSelectionWorkspaceId = workspaceSelection?.workspaceId ?? null;
  const hasHydratedWorkspaceSelectionHost = useHasHydratedWorkspaces(workspaceSelectionServerId);
  const workspaceSelectionExists = useWorkspaceExists(
    workspaceSelectionServerId,
    workspaceSelectionWorkspaceId,
  );

  const targetServerId = anyOnlineHostServerId || hosts[0]?.serverId || null;
  const client = useHostRuntimeClient(targetServerId ?? "");
  const enterFocusMode = usePanelStore((state) => state.enterFocusMode);

  useEffect(() => {
    if (!folderParam || !targetServerId || !client) return;

    const serverId = targetServerId;
    const folderPath = folderParam;
    const currentClient = client;
    let cancelled = false;

    async function handleFolderLaunch() {
      try {
        const workspace = await openFolderWorkspace({
          sessions: useSessionStore.getState().sessions,
          serverId,
          folderPath,
          client: currentClient,
        });
        if (cancelled || !workspace) return;

        useSessionStore.getState().mergeWorkspaces(serverId, [workspace]);
        enterFocusMode();
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
  }, [client, embeddedLiveDesignMessaging, enterFocusMode, folderParam, router, targetServerId]);

  const startupRoute = resolveStartupRoute({
    route: { kind: "index", pathname },
    startupBlocker: bootstrapState.startupBlocker,
    hostRegistryStatus,
    hosts,
    anyOnlineHostServerId,
    workspaceSelection,
    workspaceSelectionStatus: resolveWorkspaceSelectionStatus({
      hasHydratedWorkspaces: hasHydratedWorkspaceSelectionHost,
      workspaceExists: workspaceSelectionExists,
    }),
    isWorkspaceSelectionLoaded,
    hasGivenUpWaitingForHost: bootstrapState.hasGivenUpWaitingForHost,
  });

  if (folderParam) {
    return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
  }

  if (startupRoute.kind === "redirect") {
    return <Redirect href={startupRoute.href} />;
  }

  return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
}
