import { DEFAULT_CONTENT_MAX_WIDTH } from "@/styles/theme";

export function isBotsChatPath(pathname: string): boolean {
  return pathname.includes("/plugin/paseo-bots/");
}

export function resolveChatContentMaxWidth(
  settings: { contentMaxWidth: number | null },
  pathname: string,
): number {
  return settings.contentMaxWidth ?? (isBotsChatPath(pathname) ? 1200 : DEFAULT_CONTENT_MAX_WIDTH);
}
