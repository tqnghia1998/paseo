import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, expect, it, vi } from "vitest";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import { registerUsageSummaryRoute, summarizeUsage } from "./usage-summary.js";

const entry = (
  sourceId: string,
  report: UsageReportEntry["report"],
  extra: Partial<UsageReportEntry> = {},
): UsageReportEntry => ({
  id: `${sourceId}:account`,
  account: {},
  fetchedAt: "2026-11-05T00:00:00.000Z",
  sourceId,
  sourceLabel: sourceId === "codex" ? "Codex" : "AIS Switch",
  report,
  ...extra,
});

it("orders Codex before AIS Switch, prefers the spending allowance and skips other sources", () => {
  const entries = summarizeUsage([
    entry("ais-switch", {
      status: "available",
      windows: [
        { id: "weekly", label: "Weekly", usedPct: 10 },
        { id: "spending_allowance", label: "Allowance", remainingPct: 23 },
      ],
      balances: [{ id: "spending", label: "Spending", remaining: 294, limit: 1300, unit: "usd" }],
    }),
    entry("claude", { status: "available", windows: [{ id: "s", label: "S", usedPct: 1 }] }),
    entry(
      "codex",
      { status: "available", windows: [{ id: "5h", label: "5h", usedPct: 95 }] },
      {
        icon: "<svg/>",
      },
    ),
  ]);
  expect(entries).toEqual([
    {
      id: "codex:account",
      sourceId: "codex",
      title: "Codex",
      icon: "<svg/>",
      percentLeft: 5,
      tone: "danger",
      spending: null,
    },
    {
      id: "ais-switch:account",
      sourceId: "ais-switch",
      title: "AIS Switch",
      icon: null,
      percentLeft: 23,
      tone: "warning",
      spending: { remaining: 294, limit: 1300, unit: "usd" },
    },
  ]);
});

it("leaves out unavailable accounts and accounts without a measurable window", () => {
  expect(
    summarizeUsage([
      entry("codex", { status: "error", error: "offline" }),
      entry("ais-switch", { status: "available", windows: [{ id: "w", label: "W" }] }),
    ]),
  ).toEqual([]);
});

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function start(input: { enabled?: boolean; list?: () => Promise<UsageReportEntry[]> }) {
  const app = express();
  const listUsageReports = vi.fn(input.list ?? (async () => []));
  registerUsageSummaryRoute({
    app,
    token: "secret",
    logger: { warn: vi.fn() },
    isEnabled: () => input.enabled !== false,
    listUsageReports,
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const get = (token?: string) =>
    fetch(`http://127.0.0.1:${port}/api/usage/summary`, {
      headers: token ? { "x-paseo-worktree-cleanup-token": token } : {},
    });
  return { get, listUsageReports };
}

it("requires the host token", async () => {
  const { get, listUsageReports } = await start({});
  expect((await get()).status).toBe(403);
  expect((await get("wrong")).status).toBe(403);
  expect(listUsageReports).not.toHaveBeenCalled();
});

it("returns the summary, an off state, and a 502 when the reports fail", async () => {
  const ok = await start({
    list: async () => [
      entry("codex", { status: "available", windows: [{ id: "5h", label: "5h", usedPct: 27 }] }),
    ],
  });
  await expect((await ok.get("secret")).json()).resolves.toMatchObject({
    enabled: true,
    entries: [{ sourceId: "codex", percentLeft: 73, tone: "default" }],
  });
  await new Promise<void>((resolve) => server!.close(() => resolve()));

  const off = await start({ enabled: false });
  await expect((await off.get("secret")).json()).resolves.toEqual({ enabled: false, entries: [] });
  expect(off.listUsageReports).not.toHaveBeenCalled();
  await new Promise<void>((resolve) => server!.close(() => resolve()));

  const failing = await start({
    list: async () => {
      throw new Error("boom");
    },
  });
  expect((await failing.get("secret")).status).toBe(502);
});
