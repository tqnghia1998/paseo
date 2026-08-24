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
import { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { usePanelStore } from "@/stores/panel-store";

const isDesktop = shouldUseDesktopDaemon();

function getFolderParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function findMatchingWorkspace(
  sessions: ReturnType<typeof useSessionStore.getState>["sessions"],
  serverId: string,
  target: string,
) {
  const workspaces = sessions[serverId]?.workspaces;
  if (!workspaces) return null;
  const normalizedTarget = normalizeWorkspacePath(target) ?? target;
  for (const ws of workspaces.values()) {
    const normalizedDir = normalizeWorkspacePath(ws.workspaceDirectory) ?? ws.workspaceDirectory;
    if (normalizedDir === normalizedTarget || ws.id === target) {
      return ws;
    }
  }
  return null;
}

export default function Index() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useLocalSearchParams<{ folder?: string }>();
  const folderParam = getFolderParam(params.folder);

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
        const normalizedTarget = normalizeWorkspacePath(folderPath) ?? folderPath;
        const matchingWs = findMatchingWorkspace(
          useSessionStore.getState().sessions,
          serverId,
          normalizedTarget,
        );

        if (matchingWs) {
          if (cancelled) return;
          enterFocusMode();
          router.replace(buildHostWorkspaceRoute(serverId, matchingWs.id) as Href);
          return;
        }

        const res = await currentClient.createWorkspace({
          source: { kind: "directory", path: folderPath },
        });

        if (cancelled || !res.workspace) return;

        const normalized = normalizeWorkspaceDescriptor(res.workspace);
        useSessionStore.getState().mergeWorkspaces(serverId, [normalized]);
        enterFocusMode();
        router.replace(buildHostWorkspaceRoute(serverId, normalized.id) as Href);
      } catch (err) {
        console.error("Failed to open workspace for folder param:", err);
      }
    }

    handleFolderLaunch();

    return () => {
      cancelled = true;
    };
  }, [folderParam, targetServerId, client, router, enterFocusMode]);

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
