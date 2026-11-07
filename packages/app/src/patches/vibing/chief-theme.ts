import { UnistylesRuntime } from "react-native-unistyles";
import {
  buildDarkSemanticColors,
  buildDarkTheme,
  darkTheme,
  REGISTERED_THEMES,
  type Theme,
} from "@/styles/theme";
import { isEmbeddedChiefView } from "./focus-mode";

/**
 * Chief's own look inside its frame: dark navy surfaces and an indigo accent, so the
 * chat is unmistakably Chief's next to the host's neutral grey and lighter blue. Surfaces are
 * built through the same semantic builder as a contributed plugin theme.
 *
 * `background`, `control` and `border` are duplicated in Space App Vibing's
 * `src/components/Chief/ChiefPanel.css` (`--chief-surface`, `--chief-control`,
 * `--chief-border`): the host popup draws the header around this frame and the two
 * must be the same colours. Change them together.
 */
export const CHIEF_PALETTE = {
  background: "#141a29",
  control: "#1f2739",
  border: "#2a344a",
  ring: "#6f7a94",
  foreground: "#ffffff",
  mutedForeground: "#a3adc2",
  // An indigo blue, deeper than the host's primary blue (#3a96dd). Deep enough that
  // white text on filled buttons keeps WCAG AA (4.5:1).
  accent: "#4a6cd8",
  // Links and highlights on the dark surface.
  accentBright: "#8fa8ff",
  accentForeground: "#ffffff",
} as const;

/** The accent trio alone, for a light theme chosen in the shared settings. */
export const CHIEF_ACCENT_COLORS = {
  accent: CHIEF_PALETTE.accent,
  accentBright: CHIEF_PALETTE.accentBright,
  accentForeground: CHIEF_PALETTE.accentForeground,
} as const;

function buildChiefColors(): Theme["colors"] {
  const palette = CHIEF_PALETTE;
  const { colors } = buildDarkTheme(
    buildDarkSemanticColors({
      surface0: palette.background,
      surface1: palette.background,
      surface2: palette.control,
      surface3: palette.border,
      surface4: palette.ring,
      surfaceDiffEmpty: palette.background,
      surfaceSidebar: palette.background,
      foreground: palette.foreground,
      foregroundMuted: palette.mutedForeground,
      foregroundExtraMuted: palette.ring,
      border: palette.border,
      borderAccent: palette.border,
      accent: palette.accent,
      accentBright: palette.accentBright,
      accentForeground: palette.accentForeground,
      destructive: darkTheme.colors.destructive,
      terminalBlack: palette.control,
      terminalBrightBlack: palette.ring,
      ring: palette.ring,
    }),
  );
  // The builder reuses the accent for success; with an indigo accent that would paint
  // success states indigo, so keep the shared green.
  return { ...colors, success: colors.statusSuccess };
}

export const CHIEF_COLORS = buildChiefColors();

/**
 * Replace the colour tokens, keeping everything the appearance step set (fonts, sizes,
 * content width, and the syntax palette the user chose).
 */
export function withChiefTheme(theme: Theme): Theme {
  // `Theme` is a union of literal theme shapes that a spread cannot satisfy; the result
  // only swaps colour values, so its shape is unchanged.
  if (theme.colorScheme === "light")
    return { ...theme, colors: { ...theme.colors, ...CHIEF_ACCENT_COLORS } } as Theme;
  return { ...theme, colors: { ...CHIEF_COLORS, syntax: theme.colors.syntax } } as Theme;
}

const ALL_THEME_KEYS = Object.keys(REGISTERED_THEMES) as (keyof typeof REGISTERED_THEMES)[];

/**
 * In memory only. All Paseo frames share one origin, so choosing a theme here would
 * be saved to settings and recolour the Bots frames; this patches the live theme
 * instead. Call it after every theme or appearance update: those replace the stored
 * theme and would otherwise bring the host's colours back.
 */
export function applyChiefTheme(enabled: boolean = isEmbeddedChiefView): void {
  if (!enabled) return;
  for (const key of ALL_THEME_KEYS) UnistylesRuntime.updateTheme(key, withChiefTheme);
}
