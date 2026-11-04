import { useCallback, type ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { clampPct } from "@/usage/format";
import type { UsageTone } from "@/usage/types";
import type { Theme } from "@/styles/theme";

const SIZE = 34;
const STROKE = 3.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A usage share as a ring, coloured by its tone like UsageMeter's bar. The ring starts at 12
 * o'clock and fills clockwise; `children` sit centred inside it.
 */
export function BotUsageRing({
  percent,
  tone,
  children,
}: {
  percent: number;
  tone: UsageTone;
  children?: ReactNode;
}) {
  const colors = useCallback(
    (theme: Theme) => ({
      trackColor: theme.colors.surface3,
      progressColor: toneColor(tone, theme),
    }),
    [tone],
  );
  return (
    <View style={styles.ring} testID="bots-sidebar-usage-ring">
      <UsageRingGraphic percent={percent} uniProps={colors} />
      <View style={styles.center}>{children}</View>
    </View>
  );
}

function toneColor(tone: UsageTone, theme: Theme): string {
  switch (tone) {
    case "ok":
      return theme.colors.statusSuccess;
    case "warning":
      return theme.colors.statusWarning;
    case "danger":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

// Wrap the whole SVG: withUnistyles adds a div on web, which cannot sit inside an SVG.
const UsageRingGraphic = withUnistyles(function UsageRingGraphic({
  percent,
  trackColor,
  progressColor,
}: {
  percent: number;
  trackColor: string;
  progressColor: string;
}) {
  const dash = (clampPct(percent) / 100) * CIRCUMFERENCE;
  return (
    <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <Circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        stroke={trackColor}
        strokeWidth={STROKE}
        fill="none"
      />
      <Circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        stroke={progressColor}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
        fill="none"
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </Svg>
  );
});

const styles = StyleSheet.create(() => ({
  ring: {
    width: SIZE,
    height: SIZE,
    flexShrink: 0,
  },
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
}));
