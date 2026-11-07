import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { CHIEF_POLICY, type ChiefSession } from "./chief-session";

// Defense in depth only. The daemon's host-owned identity and permission ceiling are the
// authority; an editable label proves nothing on its own. The key must match the server side.
export const CHIEF_POLICY_LABEL = "paseo-chief.policy";

export type ChiefVerifyFailure =
  | "not-found"
  | "agent-mismatch"
  | "workspace-mismatch"
  | "cwd-mismatch"
  | "provider-mismatch"
  | "archived"
  | "policy-missing";

type ChiefAgentFacts = Pick<
  AgentSnapshotPayload,
  "id" | "provider" | "cwd" | "workspaceId" | "labels" | "archivedAt"
>;

export function verifyChiefAgent(
  agent: ChiefAgentFacts | null | undefined,
  session: ChiefSession,
): ChiefVerifyFailure | null {
  if (!agent) return "not-found";
  if (agent.id !== session.agentId) return "agent-mismatch";
  if (agent.workspaceId !== session.workspaceId) return "workspace-mismatch";
  if (agent.cwd !== session.cwd) return "cwd-mismatch";
  if (agent.provider !== session.provider) return "provider-mismatch";
  if (agent.archivedAt) return "archived";
  if (agent.labels?.[CHIEF_POLICY_LABEL] !== CHIEF_POLICY) return "policy-missing";
  return null;
}
