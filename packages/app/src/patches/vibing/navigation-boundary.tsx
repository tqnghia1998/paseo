import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { Text } from "react-native";
import { useEffect, type ReactNode } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import {
  getEmbeddedHostOrigin,
  rememberSettingsHandoff,
  subscribeToHostMessages,
} from "./host-messages";
import { Redirect, usePathname, type Href } from "expo-router";
import {
  embeddedWorkspaceRoute,
  getEmbeddedWorkspace,
  isEmbeddedRouteAllowed,
} from "./workspace-boundary";

// Gate content before mounting it, including routes reached from plugin links.
export function EmbeddedNavigationBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isEmbeddedRouteAllowed(pathname)) return children;
  const route = embeddedWorkspaceRoute();
  return route ? (
    <Redirect href={route as Href} />
  ) : (
    <Text>Reopen this workspace in Vibing to restore its navigation.</Text>
  );
}

export function useEmbeddedSettingsHandoff(): void {
  const pathname = usePathname();
  useEffect(() => {
    if (parseHostWorkspaceRouteFromPathname(pathname) || pathname.includes("/plugin/paseo-bots/"))
      return;
    const workspace = getEmbeddedWorkspace();
    const origin = getEmbeddedHostOrigin();
    if (!workspace || !origin) return;
    return subscribeToHostMessages(origin, (data) => {
      if (rememberSettingsHandoff(data)) navigateToWorkspace(workspace);
    });
  }, [pathname]);
}
