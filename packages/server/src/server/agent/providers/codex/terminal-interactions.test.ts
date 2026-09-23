import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { CodexTerminalInteractions } from "./terminal-interactions.js";

const shell: Extract<AgentTimelineItem, { type: "tool_call" }> = {
  type: "tool_call",
  callId: "shell-1",
  name: "shell",
  status: "running",
  error: null,
  detail: { type: "shell", command: "git add -p" },
};
const input = {
  source: "item" as const,
  callId: "shell-1",
  processId: "4242",
  stdin: "y\n",
};

describe("Codex terminal interactions", () => {
  it("appends live output to the last completion without repeating cumulative deltas", () => {
    const terminal = new CodexTerminalInteractions();
    const yielded = {
      ...shell,
      detail: { type: "shell" as const, command: "git add -p", output: "First hunk\n" },
    };
    terminal.track(yielded);
    terminal.recordCompletion(yielded);
    terminal.input(input);
    expect(terminal.output(shell.callId, "Second ")).toMatchObject({
      detail: { output: "First hunk\nSecond ", stdin: "y\n" },
    });
    expect(terminal.output(shell.callId, "Second hunk\n")).toMatchObject({
      detail: { output: "First hunk\nSecond hunk\n", stdin: "y\n" },
    });
    expect(terminal.withOutputBaseline(shell.callId, "Second hunk\n")).toBe(
      "First hunk\nSecond hunk\n",
    );
    expect(terminal.withOutputBaseline(shell.callId, null)).toBe("First hunk\n");
  });

  it("retains process ownership and the original timeline turn across turns", () => {
    const terminal = new CodexTerminalInteractions();
    terminal.track(shell, "turn-1");
    terminal.input(input);
    terminal.resetTurn();
    expect(terminal.input({ ...input, callId: null })).toMatchObject({
      callId: "shell-1",
      detail: { type: "shell", command: "git add -p", stdin: "y\ny\n" },
    });
    expect(terminal.turnId("shell-1")).toBe("turn-1");
  });

  it("attaches early process-only input once its command is known without repeating its mirror", () => {
    const terminal = new CodexTerminalInteractions();
    expect(terminal.input({ ...input, callId: null, source: "codex_event" })).toBeNull();
    expect(
      terminal.track({
        ...shell,
        detail: {
          ...shell.detail,
          type: "shell",
          command: "git add -p",
          output: "Process running with session id 4242",
        },
      }),
    ).toMatchObject({
      callId: "shell-1",
      detail: { stdin: "y\n" },
    });
    expect(terminal.input(input)).toBeNull();
    expect(terminal.input(input)).toMatchObject({ detail: { stdin: "y\ny\n" } });
  });
});
