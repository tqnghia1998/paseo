import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { isEmbeddedFocusMode } from "@/patches/vibing/focus-mode";
import { SPACING } from "@/styles/theme";

export const COMPOSER_PILL_CLEARANCE = {
  compact: SPACING[2],
  wide: 10,
} as const;
export const COMPOSER_PILL_MIN_HEIGHT = isEmbeddedFocusMode ? 24 : 32;
export const COMPOSER_PILL_DATASET: Record<string, string> | undefined = isWeb
  ? Object.freeze({ composerPill: "true" })
  : undefined;

export function resolveComposerPillClearance(isCompact: boolean): number {
  return isCompact ? COMPOSER_PILL_CLEARANCE.compact : COMPOSER_PILL_CLEARANCE.wide;
}

export function resolveComposerTrackTailClearance(isCompact: boolean): number {
  const composerClearance = resolveComposerPillClearance(isCompact);
  const transcriptClearance = isCompact ? SPACING[6] : 20;
  return transcriptClearance + COMPOSER_PILL_MIN_HEIGHT + composerClearance;
}

export function resolveComposerTrackControlClearance(isCompact: boolean): number {
  const clearance = resolveComposerPillClearance(isCompact);
  return clearance + COMPOSER_PILL_MIN_HEIGHT + clearance;
}

/** Shared visual contract for the compact pills immediately above the composer. */
export const composerPillStyles = StyleSheet.create((theme) => ({
  body: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: isEmbeddedFocusMode ? COMPOSER_PILL_MIN_HEIGHT : undefined,
    minHeight: COMPOSER_PILL_MIN_HEIGHT,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: isEmbeddedFocusMode ? 0 : theme.spacing[1],
    borderRadius: isEmbeddedFocusMode ? COMPOSER_PILL_MIN_HEIGHT / 2 : theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  bodyActive: {
    backgroundColor: theme.colors.surface2,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  labelActive: {
    color: theme.colors.foreground,
  },
}));
