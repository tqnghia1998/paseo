import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { QueryClientProvider } from "@tanstack/react-query";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { queryClient } from "@/data/query-client";
import { useUsageHostId } from "@/usage/hosts";
import { useUsageHostReports } from "@/usage/queries";
import { UsageSidebarRoot, useOpenSidebarUsage } from "@/usage/sidebar-item";
import { UsageSourceIcon } from "@/usage/source-icon";
import { resolveBotUsageCards } from "./bot-usage";
import { BotUsageRing } from "./bot-usage-ring";

/**
 * The Bots sidebar's usage summary, handed to the plugin like the native chat: one row with a
 * ring per source so two accounts fit the 200px sidebar. Plugin surfaces have their own query
 * cache, so it reads the app's usage reports through the app's client.
 */
export function BotUsageCard() {
  return (
    <QueryClientProvider client={queryClient}>
      <UsageSidebarRoot>
        <BotUsageCardContent />
      </UsageSidebarRoot>
    </QueryClientProvider>
  );
}

function cardStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return hovered ? [styles.card, styles.cardHovered] : styles.card;
}

function BotUsageCardContent() {
  const { t } = useTranslation();
  const openUsage = useOpenSidebarUsage();
  const reports = useUsageHostReports(useUsageHostId());
  const cards = useMemo(() => resolveBotUsageCards(reports, t), [reports, t]);
  if (cards.length === 0) return null;
  return (
    <View style={styles.row} testID="bots-sidebar-usage-row">
      {cards.map((card) => (
        <Tooltip key={card.id} delayDuration={150}>
          <TooltipTrigger asChild>
            <PressHighlight
              onPress={openUsage}
              accessibilityRole="button"
              accessibilityLabel={card.label}
              style={cardStyle}
              highlightStyle={styles.cardPressed}
              testID="bots-sidebar-usage"
            >
              <BotUsageRing percent={card.percent} tone={card.tone}>
                <UsageSourceIcon svg={card.icon} size={14} />
              </BotUsageRing>
              <Text style={styles.percent} numberOfLines={1}>
                {card.percentShort}
              </Text>
            </PressHighlight>
          </TooltipTrigger>
          <TooltipContent side="top">
            <Text style={styles.tooltipTitle}>{card.title}</Text>
            <Text style={styles.tooltipDetail}>
              {[card.percentText, card.detail].filter(Boolean).join(" · ")}
            </Text>
          </TooltipContent>
        </Tooltip>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginHorizontal: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  card: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  cardHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  cardPressed: {
    backgroundColor: theme.colors.surface2,
  },
  percent: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  tooltipDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
}));
