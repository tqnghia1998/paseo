import type { PluginTheme } from "@getpaseo/plugin";
import type { Theme } from "@/styles/theme";

// Optional colours are only present when the theme has them (standalone and third-party themes have no `selected`, and the
// Bots plugin reads its presence to tell a palette-aware host from upstream's themes).
function present<K extends string>(
  values: Record<K, string | undefined>,
): Partial<Record<K, string>> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<Record<K, string>>;
}

export function toPluginTheme(theme: Theme): PluginTheme {
  return {
    colors: {
      surface0: theme.colors.surface0,
      surface1: theme.colors.surface1,
      surface2: theme.colors.surface2,
      border: theme.colors.border,
      foreground: theme.colors.foreground,
      foregroundMuted: theme.colors.foregroundMuted,
      accent: theme.colors.accent,
      accentForeground: theme.colors.accentForeground,
      statusSuccess: theme.colors.statusSuccess,
      statusWarning: theme.colors.statusWarning,
      statusDanger: theme.colors.statusDanger,
      ...present({
        selected: theme.colors.selected,
        foregroundExtraMuted: theme.colors.foregroundExtraMuted,
        statusDotRunning: theme.colors.statusDotRunning,
        statusDotSuccess: theme.colors.statusDotSuccess,
        statusDotWarning: theme.colors.statusDotWarning,
        statusDotDanger: theme.colors.statusDotDanger,
      }),
    },
  };
}
