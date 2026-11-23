import { SPACING } from "@/styles/theme";

export const CHAT_COLUMN_BASE_GUTTER = SPACING[4];

export interface ChatColumnGutters {
  paddingLeft: number;
  paddingRight: number | string;
}

/**
 * Horizontal padding for a chat column on web.
 *
 * When the chat outline reserves `outlineInset` on the left, mirror the same inset on
 * the right so the chat column and composer stay symmetric at every pane width.
 */
export function resolveChatColumnGutters(input: {
  gutter: number;
  outlineInset: number;
  contentMaxWidth: number | undefined;
}): ChatColumnGutters {
  const padding = input.gutter + input.outlineInset;
  return { paddingLeft: padding, paddingRight: padding };
}
