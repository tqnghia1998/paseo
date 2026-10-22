import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { QueryClientProvider } from "@tanstack/react-query";
import { PressHighlight } from "@/components/ui/press-highlight";
import { queryClient } from "@/data/query-client";
import { useUsageHostId } from "@/usage/hosts";
import { useUsageHostReports } from "@/usage/queries";
import { UsageMeter } from "@/usage/meter";
import { UsageSidebarRoot, useOpenSidebarUsage } from "@/usage/sidebar-item";
import { UsageSourceIcon } from "@/usage/source-icon";
import { resolveBotUsageCards } from "./bot-usage";

/**
 * The Bots sidebar's usage card, handed to the plugin like the native chat. Plugin surfaces have
 * their own query cache, so it reads the app's usage reports through the app's client.
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
  return (
    <>
      {cards.map((card) => (
        <PressHighlight
          key={card.id}
          onPress={openUsage}
          accessibilityRole="button"
          accessibilityLabel={card.label}
          style={cardStyle}
          highlightStyle={styles.cardPressed}
          testID="bots-sidebar-usage"
        >
          <View style={styles.header}>
            <UsageSourceIcon svg={card.icon} size={14} />
            <Text style={styles.title} numberOfLines={1}>
              {card.title}
            </Text>
            <Text style={styles.percent}>{card.percentText}</Text>
          </View>
          <UsageMeter percent={card.percent} tone={card.tone} style={styles.meter} />
          {card.detail ? (
            <Text style={styles.detail} numberOfLines={1}>
              {card.detail}
            </Text>
          ) : null}
        </PressHighlight>
      ))}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    marginHorizontal: theme.spacing[2],
    marginBottom: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[1.5],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  cardHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  cardPressed: {
    backgroundColor: theme.colors.surface2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  percent: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  meter: {
    height: 4,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
}));
