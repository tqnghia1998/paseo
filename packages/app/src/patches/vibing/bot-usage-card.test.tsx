// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { UsageReportEntry } from "@/usage/types";

const fake = vi.hoisted(() => ({ reports: [] as unknown[] }));
vi.mock("@/usage/hosts", () => ({ useUsageHostId: () => "local" }));
vi.mock("@/usage/queries", () => ({ useUsageHostReports: () => fake.reports }));
vi.mock("@/usage/source-icon", () => ({ UsageSourceIcon: () => null }));
vi.mock("@/usage/usage-modal", () => ({
  UsageModal: ({ visible }: { visible: boolean }) => (visible ? <div>Usage modal</div> : null),
}));
import { BotUsageCard } from "./bot-usage-card";

afterEach(() => {
  cleanup();
  fake.reports = [];
});

const codex = {
  id: "codex/account",
  sourceId: "codex",
  sourceLabel: "Codex",
  icon: null,
  account: {},
  fetchedAt: "2026-10-21T09:59:00.000Z",
  report: {
    status: "available",
    windows: [
      {
        id: "spending_allowance",
        label: "Spending allowance",
        shortLabel: "budget",
        usedPct: 77,
        remainingPct: 23,
        resetsAt: null,
      },
    ],
    balances: [
      {
        id: "spending",
        label: "Spending",
        remaining: 294,
        limit: 1300,
        unit: "usd",
      },
    ],
  },
} as unknown as UsageReportEntry;

it("shows the Codex usage as a ring and opens Usage when pressed", () => {
  fake.reports = [codex];
  render(<BotUsageCard />);
  expect(screen.getByLabelText("Codex: 23% left, $294 of $1,300")).toBeTruthy();
  expect(screen.getByText("23%")).toBeTruthy();
  // Dollars appear only in the hover tooltip, not on the card.
  expect(screen.queryByText("$294")).toBeNull();
  expect(screen.getAllByTestId("bots-sidebar-usage-ring")).toHaveLength(1);
  expect(screen.queryByText("Usage modal")).toBeNull();
  act(() => fireEvent.click(screen.getByTestId("bots-sidebar-usage")));
  expect(screen.getByText("Usage modal")).toBeTruthy();
});

it("renders nothing without Codex usage", () => {
  const { container } = render(<BotUsageCard />);
  expect(container.textContent).toBe("");
  expect(screen.queryByTestId("bots-sidebar-usage-row")).toBeNull();
});

it("puts Codex and AIS Switch in one row and opens the same Usage view", () => {
  const ais = {
    ...codex,
    id: "ais-switch/account",
    sourceId: "ais-switch",
    sourceLabel: "AIS Switch",
  };
  fake.reports = [codex, ais];
  render(<BotUsageCard />);
  const row = screen.getByTestId("bots-sidebar-usage-row");
  const items = screen.getAllByTestId("bots-sidebar-usage");
  expect(items).toHaveLength(2);
  expect(items.every((item) => row.contains(item))).toBe(true);
  expect(screen.getByLabelText("Codex: 23% left, $294 of $1,300")).toBeTruthy();
  expect(screen.getByLabelText("AIS Switch: 23% left, $294 of $1,300")).toBeTruthy();
  act(() => fireEvent.click(items[1]!));
  expect(screen.getByText("Usage modal")).toBeTruthy();
});

it("spells out the full usage in a tooltip on hover", async () => {
  fake.reports = [codex];
  render(<BotUsageCard />);
  expect(screen.queryByText("23% left · $294 of $1,300")).toBeNull();
  fireEvent.mouseEnter(screen.getByTestId("bots-sidebar-usage"));
  await waitFor(() => expect(screen.getByText("23% left · $294 of $1,300")).toBeTruthy());
});
