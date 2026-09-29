import { useMemo } from "react";
import { CHAT_WIDE_MIN_WIDTH, getChatHorizontalSpacing } from "@/constants/layout";
import { SPACING } from "@/styles/theme";
import { useContainerWidthBelow } from "./use-container-width";

export function useChatGutter() {
  const { onLayout, isBelow } = useContainerWidthBelow(CHAT_WIDE_MIN_WIDTH);
  const spacing = getChatHorizontalSpacing(isBelow);
  const style = useMemo(() => ({ paddingHorizontal: SPACING[spacing] }), [spacing]);
  return { onLayout, style };
}
