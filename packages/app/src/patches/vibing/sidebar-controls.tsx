import { type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isEmbeddedFocusMode } from "./focus-mode";
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

export function SidebarWorkspaceArea({ children }: { children: ReactNode }) {
  if (isEmbeddedFocusMode) return <View style={styles.spacer} testID="embedded-sidebar-spacer" />;
  return children;
}

const styles = StyleSheet.create({ spacer: { flex: 1 } });
