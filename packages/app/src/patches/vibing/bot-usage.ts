import type { TFunction } from "i18next";
import { i18n } from "@/i18n/i18next";
import { formatAmount, formatDisplayPct } from "@/usage/format";
import { displayPercent } from "@/usage/model";
import { windowTone } from "@/usage/tone";
import type { UsageBalanceUnit, UsageReportEntry, UsageTone } from "@/usage/types";

/** What the Bots sidebar usage card shows. */
export interface BotUsageCard {
  id: string;
  icon: string | null;
  title: string;
  /** The share left in the window, 0-100. */
  percent: number;
  percentText: string;
  tone: UsageTone;
  /** "$294 of $1,300", short enough for the 200px sidebar; empty without an amount. */
  detail: string;
  /** The card spelled out for screen readers: "Codex: 23% left, $294 of $1,300". */
  label: string;
}

// AIS accounts for the company gateway's shared Claude/Codex allowance.
const SOURCE_IDS = ["codex", "ais-switch"];
// Enterprise plans report a spending allowance instead of 5-hour and weekly limits.
const BUDGET_WINDOW_ID = "spending_allowance";
const SPENDING_BALANCE_ID = "spending";

/** Separate account allowances in a stable source order, using the native usage reports. */
export function resolveBotUsageCards(
  reports: readonly UsageReportEntry[],
  t: TFunction = i18n.t,
): BotUsageCard[] {
  return SOURCE_IDS.flatMap((sourceId) =>
    reports
      .filter((report) => report.sourceId === sourceId)
      .flatMap((entry) => {
        const card = resolveCard(entry, t);
        return card ? [card] : [];
      }),
  );
}

function resolveCard(entry: UsageReportEntry, t: TFunction): BotUsageCard | null {
  if (entry.report.status !== "available") return null;
  const windows = entry.report.windows.filter(
    (window) => displayPercent(window, "remaining") !== null,
  );
  const window = windows.find(({ id }) => id === BUDGET_WINDOW_ID) ?? windows[0];
  if (!window) return null;
  const percent = displayPercent(window, "remaining") ?? 0;
  // The app's language, as the percent uses, not the browser's region ("US$").
  const locale = i18n.resolvedLanguage;
  const spending =
    window.id === BUDGET_WINDOW_ID
      ? entry.report.balances?.find(({ id }) => id === SPENDING_BALANCE_ID)
      : undefined;
  const detail =
    spending?.remaining != null && spending.limit != null
      ? `${shortAmount(spending.remaining, spending.unit, locale)} of ${shortAmount(spending.limit, spending.unit, locale)}`
      : "";
  const title = entry.sourceLabel;
  const percentText = formatDisplayPct(percent, "remaining", undefined, t);
  return {
    id: entry.id,
    icon: entry.icon ?? null,
    title,
    percent,
    percentText,
    tone: windowTone(window),
    detail,
    label: `${title}: ${[percentText, detail].filter(Boolean).join(", ")}`,
  };
}

/** Whole dollars, rounded down so the card never shows more than is left. */
function shortAmount(value: number, unit: UsageBalanceUnit, locale?: string): string {
  if (unit !== "usd") return formatAmount(value, unit, locale);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.floor(value));
}
