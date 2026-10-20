import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { isEmbeddedFocusMode } from "./focus-mode";

export const isEmbeddedBotsTool = isEmbeddedFocusMode;

export function resolveEmbeddedToolEntryRoute(serverId: string): string {
  return `${buildPluginSurfaceRoute(serverId, "paseo-bots", { kind: "sidebar", id: "bots" })}?view=bots`;
}
