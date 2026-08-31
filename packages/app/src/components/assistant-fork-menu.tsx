import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { Split } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { isEmbeddedChatOnly } from "@/embedded-chat-mode";

export type AssistantForkTarget = "tab" | "workspace";

interface AssistantForkMenuProps {
  onFork: (target: AssistantForkTarget) => Promise<void> | void;
  testID?: string;
}

const ThemedSplit = withUnistyles(Split);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const AssistantForkMenu = memo(function AssistantForkMenu({
  onFork,
  testID = "assistant-fork-menu",
}: AssistantForkMenuProps) {
  const { t } = useTranslation();
  const [isLocked, setIsLocked] = useState(false);

  const handlePress = useCallback(async () => {
    if (isLocked) return;
    setIsLocked(true);
    try {
      await onFork("tab");
    } finally {
      setIsLocked(false);
    }
  }, [isLocked, onFork]);

  const triggerStyle = useCallback(
    () => [styles.trigger, isLocked ? styles.triggerDisabled : null],
    [isLocked],
  );

  const tooltipContent = useMemo(
    () => (
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("message.actions.forkInNewTab")}</Text>
      </TooltipContent>
    ),
    [t],
  );

  if (isEmbeddedChatOnly) return null;

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <View style={styles.triggerSlot} collapsable={false}>
          <Pressable
            accessibilityLabel={t("message.actions.forkInNewTab")}
            accessibilityRole="button"
            disabled={isLocked}
            onPress={handlePress}
            style={triggerStyle}
            testID={`${testID}-trigger`}
          >
            {({ hovered, pressed }) => (
              <ThemedSplit
                size={ICON_SIZE.sm}
                uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            )}
          </Pressable>
        </View>
      </TooltipTrigger>
      {tooltipContent}
    </Tooltip>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  triggerDisabled: {
    opacity: theme.opacity[50],
  },
  triggerSlot: {
    alignSelf: "center",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
