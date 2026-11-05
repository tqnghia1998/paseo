import type express from "express";
import type { Logger } from "pino";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";

/**
 * One account allowance for Space App Vibing's tool rail. The host draws it next to CPU/RAM, so
 * the Bots sidebar no longer renders its own usage cards.
 */
export interface UsageSummaryEntry {
  id: string;
  sourceId: string;
  title: string;
  /** The source's validated SVG markup, or null. */
  icon: string | null;
  /** The share left in the window, 0-100. */
  percentLeft: number;
  tone: "default" | "ok" | "warning" | "danger";
  /** The spending allowance in the window's unit, when the source reports one. */
  spending: { remaining: number; limit: number; unit: string } | null;
}

// AIS accounts for the company gateway's shared Claude/Codex allowance.
const SOURCE_IDS = ["codex", "ais-switch"];
// Enterprise plans report a spending allowance instead of 5-hour and weekly limits.
const BUDGET_WINDOW_ID = "spending_allowance";
const SPENDING_BALANCE_ID = "spending";

type Report = Extract<UsageReportEntry["report"], { status: "available" }>;
type UsageWindow = Report["windows"][number];

function percentLeft(window: UsageWindow): number | null {
  if (window.remainingPct != null) return window.remainingPct;
  if (window.usedPct != null) return 100 - window.usedPct;
  return null;
}

function toneOf(window: UsageWindow, left: number): UsageSummaryEntry["tone"] {
  if (window.tone) return window.tone;
  const used = 100 - left;
  if (used > 90) return "danger";
  if (used >= 70) return "warning";
  return "default";
}

/** Codex first, then AIS Switch; accounts without an available, measurable window are left out. */
export function summarizeUsage(reports: readonly UsageReportEntry[]): UsageSummaryEntry[] {
  return SOURCE_IDS.flatMap((sourceId) =>
    reports
      .filter((entry) => entry.sourceId === sourceId && entry.report.status === "available")
      .flatMap((entry) => {
        const report = entry.report as Report;
        const windows = report.windows.filter((window) => percentLeft(window) !== null);
        const window = windows.find(({ id }) => id === BUDGET_WINDOW_ID) ?? windows[0];
        if (!window) return [];
        const left = Math.max(0, Math.min(100, percentLeft(window) ?? 0));
        const balance =
          window.id === BUDGET_WINDOW_ID
            ? report.balances?.find(({ id }) => id === SPENDING_BALANCE_ID)
            : undefined;
        return [
          {
            id: entry.id,
            sourceId: entry.sourceId,
            title: entry.sourceLabel,
            icon: entry.icon ?? null,
            percentLeft: left,
            tone: toneOf(window, left),
            spending:
              balance?.remaining != null && balance.limit != null
                ? { remaining: balance.remaining, limit: balance.limit, unit: balance.unit }
                : null,
          },
        ];
      }),
  );
}

interface UsageSummaryRouteInput {
  app: express.Express;
  token: string | undefined;
  logger: Pick<Logger, "warn">;
  isEnabled: () => boolean;
  listUsageReports: () => Promise<UsageReportEntry[]>;
}

/** Loopback, host-token-gated like /api/worktrees/activity; reuses the one-minute report cache. */
export function registerUsageSummaryRoute(input: UsageSummaryRouteInput): void {
  const { app, token, logger, isEnabled, listUsageReports } = input;
  app.get("/api/usage/summary", (req, res) => {
    const isLoopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    );
    if (!token || !isLoopback || req.header("x-paseo-worktree-cleanup-token") !== token) {
      res.status(403).end();
      return;
    }
    if (!isEnabled()) {
      res.json({ enabled: false, entries: [] });
      return;
    }
    void (async () => {
      try {
        res.json({ enabled: true, entries: summarizeUsage(await listUsageReports()) });
      } catch (error) {
        logger.warn({ err: error }, "Failed to summarize usage");
        res.status(502).json({ error: "Usage is unavailable" });
      }
    })();
  });
}
