import { useEffect } from "react";
import { useContributedThemes } from "@/appearance/provider";
import { isEmbeddedFocusMode } from "./focus-mode";

const VIBING_THEME_ID = "space-app-vibing-theme/theme/dark";

export function useEmbeddedTheme(): void {
  const { options, selected, select } = useContributedThemes();
  useEffect(() => {
    if (!isEmbeddedFocusMode || selected?.id === VIBING_THEME_ID) return;
    const theme = options.find((option) => option.id === VIBING_THEME_ID);
    if (theme) select(theme);
  }, [options, selected, select]);
}
