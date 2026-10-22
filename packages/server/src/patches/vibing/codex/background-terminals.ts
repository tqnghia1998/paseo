import type { AgentStreamEvent, AgentTimelineItem } from "../../../server/agent/agent-sdk-types.js";

type ToolCall = Extract<AgentTimelineItem, { type: "tool_call" }>;
type ProviderSubagentEvent = Extract<AgentStreamEvent, { type: "provider_subagent" }>;

const CODEX_PROVIDER = "codex";
const BACKGROUND_SHELL_TITLE = "Shell";
const MAX_DESCRIPTION_CHARS = 120;

/**
 * Vibing: Codex background terminals are rows in the subagents track, the same as backgrounded
 * Claude shells (`patches/vibing/claude/background-shells.ts`).
 *
 * Codex has no task protocol. Verified on the wire (codex-cli 0.163.0, unified exec): a command
 * the model leaves running stays `inProgress` after `turn/completed`, and its `item/completed`
 * arrives later, outside any turn, once the process exits. So a root-thread shell still running
 * when its turn completes is a background terminal. Commands the turn waited for never qualify.
 *
 * Each row opens on the command's own Shell card, which gains its output when the late
 * completion arrives. The parent transcript keeps its card unchanged.
 */
export class CodexBackgroundTerminals {
  /** Root shell cards the current turn started that have not finished yet. */
  private readonly running = new Map<string, ToolCall>();
  /** Background terminals already declared as rows, until they finish. */
  private readonly background = new Set<string>();

  /** Follow a root timeline tool call; a background terminal's completion finishes its row. */
  observe(item: ToolCall): ProviderSubagentEvent[] {
    if (item.detail.type !== "shell") return [];
    if (item.status === "running") {
      if (!this.background.has(item.callId)) this.running.set(item.callId, item);
      return [];
    }
    this.running.delete(item.callId);
    if (!this.background.delete(item.callId)) return [];
    return [timeline(item), upsert(item.callId, { status: item.status })];
  }

  /**
   * A completed turn turns its still-running shells into rows. Interrupted or failed turns do
   * not: nothing on the wire says their processes survived.
   */
  turnEnded(status: string): ProviderSubagentEvent[] {
    const stillRunning = [...this.running.values()];
    this.running.clear();
    if (status !== "completed") return [];
    const events: ProviderSubagentEvent[] = [];
    for (const item of stillRunning) {
      this.background.add(item.callId);
      events.push(
        upsert(item.callId, {
          title: BACKGROUND_SHELL_TITLE,
          description: describe(item),
          status: "running",
          toolCallId: item.callId,
        }),
        timeline(item),
      );
    }
    return events;
  }

  /** The app-server died, and every terminal it owned with it. */
  failAll(): ProviderSubagentEvent[] {
    const events = [...this.background].map((id) => upsert(id, { status: "failed" }));
    this.background.clear();
    this.running.clear();
    return events;
  }
}

function describe(item: ToolCall): string | null {
  const command = item.detail.type === "shell" ? item.detail.command.trim() : "";
  if (!command) return null;
  return command.length <= MAX_DESCRIPTION_CHARS
    ? command
    : `${command.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`;
}

function upsert(
  id: string,
  fields: {
    title?: string;
    description?: string | null;
    status: "running" | "completed" | "failed" | "canceled";
    toolCallId?: string;
  },
): ProviderSubagentEvent {
  return {
    type: "provider_subagent",
    provider: CODEX_PROVIDER,
    event: { type: "upsert", id, ...fields },
  };
}

function timeline(item: ToolCall): ProviderSubagentEvent {
  return {
    type: "provider_subagent",
    provider: CODEX_PROVIDER,
    event: { type: "timeline", id: item.callId, item },
  };
}
