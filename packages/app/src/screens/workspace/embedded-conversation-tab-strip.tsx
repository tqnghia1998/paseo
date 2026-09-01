/* eslint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop */
import { Pressable, Text, View } from "react-native";
import { Plus, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { getEmbeddedConversationTabs } from "@/embedded-chat-mode";
import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";

const ThemedPlus = withUnistyles(Plus);
const ThemedX = withUnistyles(X);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.mutedForeground });

export function EmbeddedConversationTabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCreateTab,
}: {
  tabs: WorkspaceTabDescriptor[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCreateTab: () => void;
}) {
  const conversations = getEmbeddedConversationTabs(tabs);
  return (
    <View style={styles.row} testID="embedded-conversation-tabs">
      {conversations.map((tab, index) => (
        <Pressable
          key={tab.tabId}
          testID={`embedded-conversation-tab-${tab.tabId}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTabId === tab.tabId }}
          accessibilityLabel={`Conversation ${index + 1}`}
          style={[styles.tab, activeTabId === tab.tabId && styles.activeTab]}
          onPress={() => onSelectTab(tab.tabId)}
        >
          <Text numberOfLines={1} style={styles.label}>{`Chat ${index + 1}`}</Text>
          {conversations.length > 1 ? (
            <Pressable
              testID={`embedded-conversation-tab-close-${tab.tabId}`}
              accessibilityRole="button"
              accessibilityLabel={`Close conversation ${index + 1}`}
              hitSlop={8}
              style={styles.closeButton}
              onPress={(event) => {
                event.stopPropagation();
                void onCloseTab(tab.tabId);
              }}
            >
              <ThemedX size={12} uniProps={mutedColorMapping} />
            </Pressable>
          ) : null}
        </Pressable>
      ))}
      <Pressable
        testID="embedded-conversation-tab-new"
        accessibilityRole="button"
        accessibilityLabel="New conversation"
        style={styles.newButton}
        onPress={onCreateTab}
      >
        <ThemedPlus size={14} uniProps={mutedColorMapping} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    minHeight: 36,
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  tab: {
    maxWidth: 140,
    minWidth: 0,
    height: 26,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  activeTab: { backgroundColor: theme.colors.surface2 },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  closeButton: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  newButton: {
    width: 26,
    height: 26,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
}));
