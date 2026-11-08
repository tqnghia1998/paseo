import {
  CHIEF_ACTIVITY_TYPE,
  CHIEF_CLOSE_TYPE,
  CHIEF_ERROR_TYPE,
  CHIEF_INIT_TYPE,
  CHIEF_READY_TYPE,
  CHIEF_RESTART_TYPE,
  CHIEF_VISIBILITY_TYPE,
  isChiefActivityState,
  isChiefRequestId,
  isSameChiefIdentity,
  parseChiefSession,
  type ChiefActivityState,
  type ChiefSession,
} from "./chief-session";

export type ChiefPhase = "waiting" | "verifying" | "ready" | "failed";

export interface ChiefState {
  phase: ChiefPhase;
  requestId: string | null;
  session: ChiefSession | null;
  /** Host-reported visibility; false until the host says otherwise. */
  active: boolean;
}

const INITIAL_STATE: ChiefState = {
  phase: "waiting",
  requestId: null,
  session: null,
  active: false,
};

// Error reasons are fixed codes: the host shows its own generic message, never frame text.
const REASON = /^[a-z][a-z0-9-]{0,39}$/;

interface ChiefHandshakeEnv {
  /** The verified host origin; every post is addressed to it, never "*". */
  post(message: Record<string, unknown>): void;
}

/**
 * Pure handshake state. Origin and source are checked by the caller through the shared
 * `subscribeToHostMessages` helper, so `receive` only ever sees messages from the parent.
 */
export function createChiefHandshake(env: ChiefHandshakeEnv) {
  let state = INITIAL_STATE;
  const listeners = new Set<() => void>();
  const set = (next: ChiefState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  // Latest activity the frame observed, and the last one the host was told about. Activity is
  // kept outside `state` so reports never re-render subscribers.
  let activity: ChiefActivityState = "idle";
  let postedActivity: ChiefActivityState | null = null;
  const postActivity = () => {
    postedActivity = activity;
    env.post({ type: CHIEF_ACTIVITY_TYPE, requestId: state.requestId, state: activity });
  };
  // Every ready ack (including a re-sent init or a new request id) carries the current activity.
  const ready = () => {
    env.post({
      type: CHIEF_READY_TYPE,
      requestId: state.requestId,
      agentId: state.session?.agentId,
    });
    postActivity();
  };

  function receive(data: Record<string, unknown>): void {
    if (data.type === CHIEF_INIT_TYPE) return receiveInit(data);
    if (data.type === CHIEF_VISIBILITY_TYPE) return receiveVisibility(data);
  }

  function receiveInit(data: Record<string, unknown>): void {
    if (!isChiefRequestId(data.requestId)) return;
    const session = parseChiefSession(data.session);
    if (!session) {
      env.post({ type: CHIEF_ERROR_TYPE, requestId: data.requestId, reason: "invalid-session" });
      return;
    }
    if (state.session && !isSameChiefIdentity(state.session, session)) {
      // One frame serves one Chief identity. The host must reload to change it.
      env.post({ type: CHIEF_ERROR_TYPE, requestId: data.requestId, reason: "identity-changed" });
      return;
    }
    if (state.requestId === data.requestId) {
      if (state.phase === "ready") ready();
      return;
    }
    const verified = state.phase === "ready";
    set({ ...state, requestId: data.requestId, session, phase: verified ? "ready" : "verifying" });
    if (verified) ready();
  }

  function receiveVisibility(data: Record<string, unknown>): void {
    if (data.requestId !== state.requestId || state.requestId === null) return;
    if (typeof data.active !== "boolean" || data.active === state.active) return;
    set({ ...state, active: data.active });
  }

  return {
    receive,
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The server confirmed the agent matches the descriptor. */
    verified(requestId: string): void {
      if (state.phase !== "verifying" || state.requestId !== requestId) return;
      set({ ...state, phase: "ready" });
      ready();
    },
    failed(requestId: string, reason: string): void {
      if (state.requestId !== requestId || state.phase === "ready") return;
      set({ ...state, phase: "failed" });
      env.post({
        type: CHIEF_ERROR_TYPE,
        requestId,
        reason: REASON.test(reason) ? reason : "unavailable",
      });
    },
    /**
     * The verified agent's activity. Remembered at any phase, posted only once ready, and
     * deduplicated: the host hears it on ready and then on every change.
     */
    reportActivity(next: ChiefActivityState): void {
      if (!isChiefActivityState(next)) return;
      activity = next;
      if (state.phase !== "ready" || state.requestId === null || postedActivity === next) return;
      postActivity();
    },
    /**
     * "/clear" and "/new" ask the host for a fresh conversation. The frame cannot start one:
     * it is bound to one verified agent, so the host restarts Chief and reloads the frame.
     */
    requestRestart(): void {
      if (state.phase !== "ready" || state.requestId === null) return;
      env.post({ type: CHIEF_RESTART_TYPE, requestId: state.requestId });
    },
    /** Escape inside the frame asks the host to close; it never closes anything itself. */
    requestClose(): void {
      if (state.phase !== "ready" || state.requestId === null) return;
      env.post({ type: CHIEF_CLOSE_TYPE, requestId: state.requestId });
    },
  };
}

export type ChiefHandshake = ReturnType<typeof createChiefHandshake>;
