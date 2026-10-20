import { useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Bot } from "lucide-react-native";
import { router } from "expo-router";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { resolvePluginSurfaceContribution } from "@/plugins/surface-contribution";
import { usePanelStore } from "@/stores/panel-store";
import { isEmbeddedFocusMode } from "./focus-mode";
import { useEmbeddedWorkspace } from "./workspace-boundary";

const botsIdentity = { kind: "sidebar", id: "bots" } as const;

export function SidebarWorkspaceArea({ children }: { children: ReactNode }) {
  if (isEmbeddedFocusMode) return <View style={styles.spacer} testID="embedded-sidebar-spacer" />;
  return children;
}

export function EmbeddedBotsButton() {
  const bound = useEmbeddedWorkspace();
  const plugin = useInstalledPlugin(bound?.serverId ?? "", "paseo-bots");
  const isCompact = useIsCompactFormFactor();
  const closeAgentListForLayout = usePanelStore((state) => state.closeAgentListForLayout);
  const open = useCallback(() => {
    if (!bound || !plugin) return;
    if (isCompact) closeAgentListForLayout({ isCompact: true });
    router.push(buildPluginSurfaceRoute(bound.serverId, plugin.id, botsIdentity));
  }, [bound, plugin, isCompact, closeAgentListForLayout]);
  const { surface } = resolvePluginSurfaceContribution(plugin, botsIdentity);
  if (!isEmbeddedFocusMode || !bound || !surface) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={Bot}
      onPress={open}
      accessibilityLabel="Open Bots"
      testID="embedded-bots-button"
    >
      Bots
    </Button>
  );
}

const styles = StyleSheet.create({ spacer: { flex: 1 } });
