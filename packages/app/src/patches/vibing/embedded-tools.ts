import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { isEmbeddedFocusMode } from "./focus-mode";

export function isBotsToolEntry(frameName: string, search: string): boolean {
  return (
    frameName.startsWith("paseo-workspace:bots:") ||
    new URLSearchParams(search).get("view") === "bots"
  );
}

export const isEmbeddedBotsTool =
  isEmbeddedFocusMode &&
  typeof window !== "undefined" &&
  isBotsToolEntry(window.name, window.location.search);

export function resolveEmbeddedToolEntryRoute(
  serverId: string,
  workspaceId: string,
  bots: boolean,
): string {
  return bots
    ? `${buildPluginSurfaceRoute(serverId, "paseo-bots", { kind: "sidebar", id: "bots" })}?view=bots`
    : buildHostWorkspaceRoute(serverId, workspaceId);
}
