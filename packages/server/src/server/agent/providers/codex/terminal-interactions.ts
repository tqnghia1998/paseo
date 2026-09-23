import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { extractCodexTerminalSessionId } from "../tool-call-mapper-utils.js";

type ToolCall = Extract<AgentTimelineItem, { type: "tool_call" }>;

interface TerminalInteraction {
  source: "item" | "codex_event";
  callId: string | null;
  processId: string | null;
  stdin: string | null;
}

export class CodexTerminalInteractions {
  private shells = new Map<string, ToolCall>();
  private inputByCallId = new Map<string, string>();
  private callIdByProcessId = new Map<string, string>();
  private pendingInputByProcessId = new Map<string, string>();
  private turnIdByCallId = new Map<string, string>();
  private outputBaselineByCallId = new Map<string, string>();
  private unpairedNotifications = new Map<string, number>();

  resetTurn(): Set<string> {
    // A yielded PTY can receive input in later turns. Only forget ordinary commands.
    const retained = new Set(this.callIdByProcessId.values());
    for (const callId of this.shells.keys()) {
      if (retained.has(callId)) continue;
      this.shells.delete(callId);
      this.inputByCallId.delete(callId);
      this.turnIdByCallId.delete(callId);
      this.outputBaselineByCallId.delete(callId);
    }
    this.unpairedNotifications.clear();
    return retained;
  }

  isInteractive(callId: string): boolean {
    return this.inputByCallId.has(callId);
  }

  turnId(callId: string): string | undefined {
    return this.turnIdByCallId.get(callId);
  }

  track(item: ToolCall, turnId?: string): ToolCall {
    if (turnId && (item.detail.type === "shell" || item.name === "terminal_input")) {
      if (!this.turnIdByCallId.has(item.callId)) this.turnIdByCallId.set(item.callId, turnId);
    }
    if (item.detail.type !== "shell") return item;
    const processId = extractCodexTerminalSessionId(item.detail.output);
    if (processId) this.bindProcess(processId, item.callId);
    const stdin = this.inputByCallId.get(item.callId);
    const enriched = stdin ? { ...item, detail: { ...item.detail, stdin } } : item;
    this.shells.set(item.callId, enriched);
    return enriched;
  }

  output(callId: string, output: string): ToolCall | null {
    const shell = this.shells.get(callId);
    if (!shell || shell.detail.type !== "shell") return null;
    output = this.withOutputBaseline(callId, output) ?? output;
    if (shell.detail.output === output) return null;
    return this.track({ ...shell, detail: { ...shell.detail, output } });
  }

  recordCompletion(item: AgentTimelineItem): void {
    if (
      item.type === "tool_call" &&
      item.detail.type === "shell" &&
      item.detail.output !== undefined
    ) {
      // Completion can yield a still-live PTY; future deltas start after this snapshot.
      this.outputBaselineByCallId.set(item.callId, item.detail.output);
    }
  }

  withOutputBaseline(callId: string, output: string | null): string | null {
    const baseline = this.outputBaselineByCallId.get(callId);
    return output === null ? (baseline ?? null) : (baseline ?? "") + output;
  }

  input(interaction: TerminalInteraction): ToolCall | null {
    if (!interaction.stdin) return null;
    const callId = this.resolveCallId(interaction);
    const adopted =
      callId && interaction.processId ? this.bindProcess(interaction.processId, callId) : false;

    // Pair mirrored notifications, not input values: two genuine "y" writes must survive.
    const key = JSON.stringify([
      interaction.processId ? ["process", interaction.processId] : ["call", callId],
      interaction.stdin,
    ]);
    const direction = interaction.source === "item" ? 1 : -1;
    const unpaired = this.unpairedNotifications.get(key) ?? 0;
    this.unpairedNotifications.set(key, unpaired + direction);
    if (unpaired * direction < 0) {
      const shell = adopted && callId ? this.shells.get(callId) : undefined;
      return shell ? this.track(shell) : null;
    }

    if (!callId) {
      if (interaction.processId) {
        const pending = this.pendingInputByProcessId.get(interaction.processId) ?? "";
        this.pendingInputByProcessId.set(interaction.processId, pending + interaction.stdin);
      }
      return null;
    }

    const stdin = (this.inputByCallId.get(callId) ?? "") + interaction.stdin;
    this.inputByCallId.set(callId, stdin);
    const shell = this.shells.get(callId);
    if (shell) return this.track(shell);

    // An interaction can precede its command announcement. Reuse the parent ID
    // so the normal tool-call projection replaces this input-only placeholder.
    return {
      type: "tool_call",
      callId,
      name: "terminal_input",
      status: "completed",
      error: null,
      detail: { type: "plain_text", label: "Input", text: stdin, icon: "square_terminal" },
    };
  }

  resolveCallId(interaction: TerminalInteraction): string | null {
    if (interaction.callId && this.shells.has(interaction.callId)) return interaction.callId;
    const processCallId = interaction.processId
      ? this.callIdByProcessId.get(interaction.processId)
      : undefined;
    return processCallId ?? interaction.callId;
  }

  private bindProcess(processId: string, callId: string): boolean {
    this.callIdByProcessId.set(processId, callId);
    const pending = this.pendingInputByProcessId.get(processId);
    if (!pending) return false;
    this.inputByCallId.set(callId, (this.inputByCallId.get(callId) ?? "") + pending);
    this.pendingInputByProcessId.delete(processId);
    return true;
  }
}
