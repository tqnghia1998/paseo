// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    balances: [{ id: "spending", label: "Spending", remaining: 294, limit: 1300, unit: "usd" }],
  },
} as unknown as UsageReportEntry;

it("shows the Codex usage card and opens Usage when pressed", () => {
  fake.reports = [codex];
  render(<BotUsageCard />);
  expect(screen.getByText("Codex")).toBeTruthy();
  expect(screen.getByText("23% left")).toBeTruthy();
  expect(screen.getByText("$294 of $1,300")).toBeTruthy();
  expect(screen.queryByText("Usage modal")).toBeNull();
  act(() => fireEvent.click(screen.getByTestId("bots-sidebar-usage")));
  expect(screen.getByText("Usage modal")).toBeTruthy();
});

it("renders nothing without Codex usage", () => {
  const { container } = render(<BotUsageCard />);
  expect(container.textContent).toBe("");
});

it("shows AIS Switch alongside Codex and opens the same Usage view", () => {
  const ais = {
    ...codex,
    id: "ais-switch/account",
    sourceId: "ais-switch",
    sourceLabel: "AIS Switch",
  };
  fake.reports = [codex, ais];
  render(<BotUsageCard />);
  expect(screen.getByText("Codex")).toBeTruthy();
  expect(screen.getByText("AIS Switch")).toBeTruthy();
  act(() => fireEvent.click(screen.getAllByTestId("bots-sidebar-usage")[1]!));
  expect(screen.getByText("Usage modal")).toBeTruthy();
});
