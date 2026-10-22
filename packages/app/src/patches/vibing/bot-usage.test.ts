import { expect, it } from "vitest";
import type { UsageReportEntry } from "@/usage/types";
import { resolveBotUsageCards } from "./bot-usage";

function entry(
  sourceId: string,
  sourceLabel: string,
  report: UsageReportEntry["report"],
): UsageReportEntry {
  return {
    id: `${sourceId}/account`,
    sourceId,
    sourceLabel,
    icon: `<svg>${sourceId}</svg>`,
    account: {},
    fetchedAt: "2026-10-21T09:59:00.000Z",
    report,
  };
}

const enterpriseCodex = entry("codex", "Codex", {
  status: "available",
  planLabel: "Enterprise",
  windows: [
    {
      id: "spending_allowance",
      label: "Spending allowance",
      shortLabel: "budget",
      usedPct: 77,
      remainingPct: 23,
      resetsAt: "2026-11-01T12:00:00.000Z",
    },
  ],
  balances: [
    {
      id: "spending",
      label: "Spending",
      used: 1005.94,
      remaining: 294.9,
      limit: 1300,
      unit: "usd",
      tone: "warning",
    },
    { id: "spending_remaining", label: "Remaining allowance", remaining: 294.9, unit: "usd" },
  ],
} as UsageReportEntry["report"]);

const claude = entry("claude", "Claude", {
  status: "available",
  windows: [{ id: "five_hour", label: "Session", shortLabel: "5h", usedPct: 10, resetsAt: null }],
  balances: [],
} as UsageReportEntry["report"]);

it("shows how much of the Codex budget is left in whole dollars, short enough for a narrow sidebar", () => {
  expect(resolveBotUsageCards([enterpriseCodex])[0]).toEqual({
    id: "codex/account",
    icon: "<svg>codex</svg>",
    title: "Codex",
    percent: 23,
    percentText: "23% left",
    tone: "warning",
    detail: "$294 of $1,300",
    label: "Codex: 23% left, $294 of $1,300",
  });
});

it("leaves Claude out even when it reports usage", () => {
  expect(resolveBotUsageCards([claude])).toEqual([]);
  expect(resolveBotUsageCards([claude, enterpriseCodex])[0]?.percent).toBe(23);
});

it("hides the card while Codex has no usable report", () => {
  expect(resolveBotUsageCards([])).toEqual([]);
  const unavailable = entry("codex", "Codex", {
    status: "unavailable",
    problem: { kind: "missing" },
  } as unknown as UsageReportEntry["report"]);
  expect(resolveBotUsageCards([unavailable])).toEqual([]);
});

it("falls back to the first Codex limit, without an amount, when there is no spending allowance", () => {
  const personal = entry("codex", "Codex", {
    status: "available",
    windows: [
      {
        id: "five_hour",
        label: "Session",
        shortLabel: "5h",
        usedPct: 40,
        resetsAt: "2026-10-21T12:30:00.000Z",
      },
    ],
    balances: [],
  } as UsageReportEntry["report"]);
  expect(resolveBotUsageCards([personal])[0]).toMatchObject({
    title: "Codex",
    percent: 60,
    percentText: "60% left",
    detail: "",
    label: "Codex: 60% left",
  });
});

it("shows separate Codex and AIS Switch quotas without duplicating the shared AIS allowance", () => {
  const ais = entry("ais-switch", "AIS Switch", {
    status: "available",
    windows: [
      {
        id: "spending_allowance",
        label: "Monthly AQP",
        usedPct: 61.9,
        remainingPct: 38.1,
        resetsAt: null,
      },
    ],
    balances: [{ id: "spending", label: "Monthly AQP", remaining: 381, limit: 1000, unit: "usd" }],
  } as UsageReportEntry["report"]);
  expect(resolveBotUsageCards([ais, claude, enterpriseCodex])).toMatchObject([
    { id: "codex/account", title: "Codex", detail: "$294 of $1,300" },
    { id: "ais-switch/account", title: "AIS Switch", percent: 38.1, detail: "$381 of $1,000" },
  ]);
  expect(resolveBotUsageCards([ais])).toMatchObject([{ title: "AIS Switch" }]);
  expect(resolveBotUsageCards([])).toEqual([]);
});
