import { type ReactNode } from "react";
import { isEmbeddedFocusMode, isEmbeddedTasksView } from "./focus-mode";

export function EmbeddedPluginHeader({
  pluginId,
  children,
}: {
  pluginId: string;
  children: ReactNode;
}) {
  if (!isEmbeddedFocusMode) return children;
  if (pluginId === "paseo-bots") return null;
  if (isEmbeddedTasksView && pluginId === "better-paseo") return null;
  return children;
}
