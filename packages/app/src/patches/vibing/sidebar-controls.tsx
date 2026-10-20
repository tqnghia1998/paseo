import { type ReactNode } from "react";
import { isEmbeddedBotsTool } from "./embedded-tools";

export function EmbeddedPluginHeader({
  pluginId,
  children,
}: {
  pluginId: string;
  children: ReactNode;
}) {
  return isEmbeddedBotsTool && pluginId === "paseo-bots" ? null : children;
}
