import { type ReactNode } from "react";
import { isEmbeddedFocusMode } from "./focus-mode";

export function EmbeddedPluginHeader({
  pluginId,
  children,
}: {
  pluginId: string;
  children: ReactNode;
}) {
  return isEmbeddedFocusMode && pluginId === "paseo-bots" ? null : children;
}
