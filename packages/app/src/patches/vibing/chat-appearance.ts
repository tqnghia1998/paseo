import { resolveContentMaxWidth, type AppSettings } from "@/hooks/use-settings";

export function isBotsChatPath(pathname: string): boolean {
  return pathname.includes("/plugin/paseo-bots/");
}

export function resolveChatContentMaxWidth(
  settings: Pick<AppSettings, "contentWidth">,
  pathname: string,
): number | undefined {
  return resolveContentMaxWidth(
    settings.contentWidth === "default" && isBotsChatPath(pathname)
      ? { contentWidth: "wide" }
      : settings,
  );
}
