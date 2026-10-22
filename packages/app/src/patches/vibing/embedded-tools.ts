import { buildPluginSurfaceRoute } from "@/plugins/routes";

export function resolveEmbeddedToolEntryRoute(serverId: string): string {
  return `${buildPluginSurfaceRoute(serverId, "paseo-bots", { kind: "sidebar", id: "bots" })}?view=bots`;
}
