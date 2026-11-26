import { buildPluginSurfaceRoute } from "@/plugins/routes";

export function resolveEmbeddedToolEntryRoute(serverId: string): string {
  return `${buildPluginSurfaceRoute(serverId, "paseo-bots", { kind: "sidebar", id: "bots" })}?view=bots`;
}

export function resolveEmbeddedTasksEntryRoute(serverId: string): string {
  return `${buildPluginSurfaceRoute(serverId, "better-paseo", { kind: "surface", id: "tasks" })}?view=tasks`;
}
