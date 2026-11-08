export const CHIEF_INIT_TYPE = "space:chief-init";
export const CHIEF_VISIBILITY_TYPE = "space:chief-visibility";
export const CHIEF_READY_TYPE = "paseo:chief-ready";
export const CHIEF_CLOSE_TYPE = "paseo:chief-close";
export const CHIEF_RESTART_TYPE = "paseo:chief-restart";
export const CHIEF_ERROR_TYPE = "paseo:chief-error";
export const CHIEF_ACTIVITY_TYPE = "paseo:chief-activity";

/** What the host launcher shows: Working, Needs input, or (after working) Finished. */
export type ChiefActivityState = "idle" | "working" | "needs-input";
const CHIEF_ACTIVITY_STATES: ReadonlySet<unknown> = new Set<ChiefActivityState>([
  "idle",
  "working",
  "needs-input",
]);

export function isChiefActivityState(value: unknown): value is ChiefActivityState {
  return CHIEF_ACTIVITY_STATES.has(value);
}

export const CHIEF_PROTOCOL = 1;
export const CHIEF_POLICY = "chief-v1";
export const MAX_CHIEF_REQUEST_ID_LENGTH = 128;

// The host strips its own port: nothing in this descriptor is a credential.
export interface ChiefSession {
  protocol: typeof CHIEF_PROTOCOL;
  status: "ready";
  policy: typeof CHIEF_POLICY;
  serverId: string;
  agentId: string;
  workspaceId: string;
  cwd: string;
  provider: string;
}

const SESSION_KEYS = [
  "protocol",
  "status",
  "policy",
  "serverId",
  "agentId",
  "workspaceId",
  "cwd",
  "provider",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isChiefRequestId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= MAX_CHIEF_REQUEST_ID_LENGTH
  );
}

const hasControlCharacters = (value: string) =>
  Array.from(value).some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const isIdentity = (value: unknown): value is string =>
  isNonEmptyString(value) && value.length <= 128 && !hasControlCharacters(value);

/** Strict: exact keys, exact literals. Anything else is not a Chief session. */
export function parseChiefSession(value: unknown): ChiefSession | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== SESSION_KEYS.length || !SESSION_KEYS.every((key) => key in record)) {
    return null;
  }
  if (
    record.protocol !== CHIEF_PROTOCOL ||
    record.status !== "ready" ||
    record.policy !== CHIEF_POLICY ||
    !isNonEmptyString(record.provider) ||
    record.provider.length > 100 ||
    !isIdentity(record.serverId) ||
    !isIdentity(record.agentId) ||
    !isIdentity(record.workspaceId) ||
    !isNonEmptyString(record.cwd) ||
    record.cwd.length > 4096 ||
    hasControlCharacters(record.cwd) ||
    hasControlCharacters(record.provider)
  ) {
    return null;
  }
  return {
    protocol: CHIEF_PROTOCOL,
    status: "ready",
    policy: CHIEF_POLICY,
    serverId: record.serverId,
    agentId: record.agentId,
    workspaceId: record.workspaceId,
    cwd: record.cwd,
    provider: record.provider,
  };
}

export function isSameChiefIdentity(a: ChiefSession, b: ChiefSession): boolean {
  return (
    a.serverId === b.serverId &&
    a.agentId === b.agentId &&
    a.workspaceId === b.workspaceId &&
    a.cwd === b.cwd
  );
}
