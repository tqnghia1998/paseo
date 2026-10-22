import { describe, expect, it } from "vitest";

import type { AgentTimelineItem } from "../../../server/agent/agent-sdk-types.js";
import { CodexBackgroundTerminals } from "./background-terminals.js";

type ToolCall = Extract<AgentTimelineItem, { type: "tool_call" }>;

function shell(
  callId: string,
  status: ToolCall["status"],
  command = "pnpm test",
  output?: string,
): ToolCall {
  return {
    type: "tool_call",
    callId,
    name: "shell",
    status,
    error: status === "failed" ? { message: "exit 1" } : null,
    detail: { type: "shell", command, ...(output === undefined ? {} : { output }) },
  } as ToolCall;
}

describe("CodexBackgroundTerminals", () => {
  it("declares only the shells still running when the turn completes", () => {
    const terminals = new CodexBackgroundTerminals();
    terminals.observe(shell("waited", "running"));
    terminals.observe(shell("waited", "completed", "pnpm test", "ok"));
    terminals.observe(shell("bg", "running", "pnpm dev"));

    expect(terminals.turnEnded("completed")).toEqual([
      {
        type: "provider_subagent",
        provider: "codex",
        event: {
          type: "upsert",
          id: "bg",
          title: "Shell",
          description: "pnpm dev",
          status: "running",
          toolCallId: "bg",
        },
      },
      {
        type: "provider_subagent",
        provider: "codex",
        event: { type: "timeline", id: "bg", item: shell("bg", "running", "pnpm dev") },
      },
    ]);
    // A later turn ending does not declare it twice.
    expect(terminals.turnEnded("completed")).toEqual([]);
  });

  it("finishes a background row with its failed card", () => {
    const terminals = new CodexBackgroundTerminals();
    terminals.observe(shell("bg", "running"));
    terminals.turnEnded("completed");
    const failed = shell("bg", "failed", "pnpm test", "1 failed");

    expect(terminals.observe(failed)).toEqual([
      {
        type: "provider_subagent",
        provider: "codex",
        event: { type: "timeline", id: "bg", item: failed },
      },
      {
        type: "provider_subagent",
        provider: "codex",
        event: { type: "upsert", id: "bg", status: "failed" },
      },
    ]);
    expect(terminals.observe(failed)).toEqual([]);
  });

  it("ignores non-shell tool calls and shortens long commands", () => {
    const terminals = new CodexBackgroundTerminals();
    terminals.observe({
      ...shell("read", "running"),
      detail: { type: "read", filePath: "a" },
    } as ToolCall);
    terminals.observe(shell("long", "running", "x".repeat(300)));
    const [declared] = terminals.turnEnded("completed");

    expect(declared?.event).toMatchObject({ id: "long", description: expect.any(String) });
    expect((declared?.event as { description?: string } | undefined)?.description).toHaveLength(
      120,
    );
  });

  it("fails every background terminal when the app-server dies", () => {
    const terminals = new CodexBackgroundTerminals();
    terminals.observe(shell("bg", "running"));
    terminals.turnEnded("completed");

    expect(terminals.failAll()).toEqual([
      {
        type: "provider_subagent",
        provider: "codex",
        event: { type: "upsert", id: "bg", status: "failed" },
      },
    ]);
    expect(terminals.failAll()).toEqual([]);
  });
});
