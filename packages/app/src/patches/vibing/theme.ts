import { useEffect, useRef } from "react";
import { useContributedThemes } from "@/appearance/provider";
import { isEmbeddedFocusMode } from "./focus-mode";

const VIBING_THEME_ID = "space-app-vibing-theme/theme/dark";

export function useEmbeddedTheme(): void {
  const initialized = useRef(false);
  const { options, selected, select } = useContributedThemes();
  useEffect(() => {
    if (!isEmbeddedFocusMode || initialized.current) return;
    try {
      if (localStorage.getItem("paseo:vibing-theme-initialized")) return;
    } catch {
      /* Apply once in memory if browser storage is unavailable. */
    }
    const theme = options.find((option) => option.id === VIBING_THEME_ID);
    if (!theme) return;
    initialized.current = true;
    try {
      localStorage.setItem("paseo:vibing-theme-initialized", "1");
    } catch {
      /* In-memory fallback. */
    }
    if (selected?.id !== VIBING_THEME_ID) select(theme);
  }, [options, selected, select]);
}
