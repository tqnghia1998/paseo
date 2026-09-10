const AGENT_TOOLTIP_TITLE_MAX_LENGTH = 80;

export function normalizeAgentTooltipTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

export function formatAgentTooltipTitle(singleLineTitle: string): string {
  if (singleLineTitle.length <= AGENT_TOOLTIP_TITLE_MAX_LENGTH) return singleLineTitle;
  return `${singleLineTitle.slice(0, AGENT_TOOLTIP_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}
