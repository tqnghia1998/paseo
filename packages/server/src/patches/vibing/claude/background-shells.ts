import fs from "node:fs";

import type { AgentMetadata, ToolCallTimelineItem } from "../../../server/agent/agent-sdk-types.js";
import type { ProviderSubagentStatus } from "../../../server/agent/provider-subagents/store.js";
import {
  mapClaudeCanceledToolCall,
  mapClaudeCompletedToolCall,
  mapClaudeFailedToolCall,
  mapClaudeRunningToolCall,
} from "../../../server/agent/providers/claude/tool-call-mapper.js";

/**
 * Vibing: backgrounded Claude shell commands are rows in the subagents track, so a chat that
 * leaves long checks running can be monitored the same way as one that fans out subagents.
 *
 * Claude Code announces every long-lived shell as a `local_bash` task, foreground or not. Only
 * a backgrounded one outlives its tool call, so a shell is declared when it is registered in the
 * background or later moved there; foreground shells never reach the track.
 *
 * A shell has no transcript of its own. Its row opens on one Shell card: the command while it
 * runs, then the command with the tail of its output once Claude reports it finished.
 */
export const CLAUDE_BACKGROUND_SHELL_TASK_TYPE = "local_bash";
export const CLAUDE_BACKGROUND_SHELL_TITLE = "Shell";

const MAX_SHELL_OUTPUT_TAIL_BYTES = 64 * 1024;

export function isClaudeShellTask(taskType: string | undefined): boolean {
  return taskType === CLAUDE_BACKGROUND_SHELL_TASK_TYPE;
}

/**
 * The parent's Bash input when it is still known, otherwise Claude's task description, which
 * names the command well enough for the card to be meaningful.
 */
function resolveShellInput(
  input: AgentMetadata | null | undefined,
  description: string | undefined,
): AgentMetadata | null {
  if (input && typeof input.command === "string" && input.command.trim().length > 0) {
    return input;
  }
  return description ? { command: description } : null;
}

export function buildClaudeBackgroundShellCard(params: {
  id: string;
  input: AgentMetadata | null | undefined;
  description: string | undefined;
  status: ProviderSubagentStatus;
  output?: string;
}): ToolCallTimelineItem | null {
  const call = {
    name: "Bash",
    callId: params.id,
    input: resolveShellInput(params.input, params.description),
    output: params.output ?? null,
  };
  switch (params.status) {
    case "running":
      return mapClaudeRunningToolCall(call);
    case "completed":
      return mapClaudeCompletedToolCall(call);
    case "canceled":
      return mapClaudeCanceledToolCall(call);
    default:
      return mapClaudeFailedToolCall({ ...call, error: { message: "Command failed" } });
  }
}

/** The last 64 KiB of a finished shell's output file, starting on a whole line. */
export function readClaudeBackgroundShellOutput(outputFile: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(outputFile, "r");
    const size = fs.fstatSync(descriptor).size;
    const start = Math.max(0, size - MAX_SHELL_OUTPUT_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = fs.readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        start + bytesRead,
      );
      if (count === 0) break;
      bytesRead += count;
    }
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = `…\n${firstNewline >= 0 ? text.slice(firstNewline + 1) : text}`;
    }
    return text.trimEnd();
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
