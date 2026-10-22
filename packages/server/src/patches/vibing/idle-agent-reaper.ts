import type { Logger } from "pino";
import type { ManagedAgent } from "../../server/agent/agent-manager.js";

// Every loaded agent keeps its provider process alive (a Claude CLI plus its MCP
// servers), even when idle. The reaper closes agents that have been idle for a
// while; their chats stay listed, and the next message or open resumes them
// from persistence, as after a daemon restart.

const DEFAULT_IDLE_MINUTES = 10;
const SWEEP_INTERVAL_MS = 60_000;

type IdleCheckAgent = Pick<
  ManagedAgent,
  | "lifecycle"
  | "internal"
  | "activeForegroundTurnId"
  | "activeTurnId"
  | "pendingPermissions"
  | "pendingReplacement"
>;

/** Nothing in flight: no run, turn, permission prompt, or running background shell or subagent. */
export function canCloseIdleAgent(
  agent: IdleCheckAgent,
  state: { hasRun: boolean; providerSubagents: ReadonlyArray<{ status: string }> },
): boolean {
  return (
    agent.lifecycle === "idle" &&
    !agent.internal &&
    !state.hasRun &&
    !agent.activeForegroundTurnId &&
    !agent.activeTurnId &&
    agent.pendingPermissions.size === 0 &&
    !agent.pendingReplacement &&
    !state.providerSubagents.some((subagent) => subagent.status === "running")
  );
}

export interface IdleAgentReaperManager {
  listAgents(): ManagedAgent[];
  closeIdleAgent(agentId: string): Promise<boolean>;
}

/** `PASEO_IDLE_AGENT_CLOSE_MINUTES`: minutes idle before closing, `0` to keep agents loaded. */
export function idleAgentCloseMsFromEnv(env: NodeJS.ProcessEnv): number | null {
  const value = env.PASEO_IDLE_AGENT_CLOSE_MINUTES?.trim();
  const minutes = value ? Number(value) : DEFAULT_IDLE_MINUTES;
  if (minutes === 0) return null;
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_MINUTES) * 60_000;
}

export function startIdleAgentReaper(options: {
  agentManager: IdleAgentReaperManager;
  logger: Logger;
  idleMs: number;
}): () => void {
  const { agentManager, idleMs } = options;
  const logger = options.logger.child({ module: "idle-agent-reaper" });
  // When the reaper first saw each loaded agent, so one reopened with old
  // activity still gets a full idle period.
  const firstSeenAt = new Map<string, number>();
  let sweeping = false;

  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const now = Date.now();
      const agents = agentManager.listAgents();
      const loaded = new Set(agents.map((agent) => agent.id));
      for (const agentId of firstSeenAt.keys()) {
        if (!loaded.has(agentId)) firstSeenAt.delete(agentId);
      }
      for (const agent of agents) {
        if (!firstSeenAt.has(agent.id)) firstSeenAt.set(agent.id, now);
        if (
          !agent.persistence ||
          !canCloseIdleAgent(agent, { hasRun: false, providerSubagents: [] })
        ) {
          continue;
        }
        const lastActivity = Math.max(agent.updatedAt.getTime(), firstSeenAt.get(agent.id)!);
        if (now - lastActivity < idleMs) continue;
        try {
          if (await agentManager.closeIdleAgent(agent.id)) {
            firstSeenAt.delete(agent.id);
            logger.info({ agentId: agent.id, provider: agent.provider }, "Closed idle agent");
          }
        } catch (error) {
          logger.warn({ err: error, agentId: agent.id }, "Failed to close idle agent");
        }
      }
    } finally {
      sweeping = false;
    }
  };

  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  timer.unref?.();
  void sweep();
  return () => clearInterval(timer);
}
