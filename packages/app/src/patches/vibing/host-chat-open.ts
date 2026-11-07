import { useEffect, useRef } from "react";
import { getEmbeddedHostOrigin, subscribeToHostMessages } from "./host-messages";

const OPEN_CHAT = "space:paseo-open-chat";
const OPEN_CHAT_ACK = "paseo:open-chat-ack";
/** A chat the host just started may reach this frame's store a moment after its request. */
const SETTLE_MS = 3000;
const MAX_RECENT_REQUESTS = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "wait" until the bot inventory and agents are ready, or a new chat arrives. */
export type OpenChatVerdict = "open" | "wait" | "reject";

// The host re-sends every 500 ms until acknowledged, so answer repeats from memory.
const settled = new Map<string, boolean>();
const firstSeen = new Map<string, number>();
function remember<T>(map: Map<string, T>, key: string, value: T): void {
  map.set(key, value);
  if (map.size > MAX_RECENT_REQUESTS) map.delete(map.keys().next().value!);
}

/**
 * Opens a host-selected chat (Chief's handoff Open button) in this frame's Bots view.
 * Only the embedding parent origin may ask; the frame decides whether the chat is in scope.
 */
export function useEmbeddedChatOpen(input: {
  enabled: boolean;
  evaluate(agentId: string): OpenChatVerdict;
  open(agentId: string): void;
}): void {
  const latest = useRef(input);
  latest.current = input;
  const { enabled } = input;
  useEffect(() => {
    if (!enabled) return;
    const origin = getEmbeddedHostOrigin();
    if (!origin) return;
    const reply = (requestId: string, ok: boolean) =>
      window.parent.postMessage({ type: OPEN_CHAT_ACK, requestId, ok }, origin);
    return subscribeToHostMessages(origin, (data) => {
      const { type, requestId, agentId } = data;
      if (type !== OPEN_CHAT || typeof requestId !== "string" || !UUID.test(requestId)) return;
      if (typeof agentId !== "string" || !UUID.test(agentId)) return;
      const previous = settled.get(requestId);
      if (previous !== undefined) {
        reply(requestId, previous);
        return;
      }
      const now = Date.now();
      const started = firstSeen.get(requestId) ?? now;
      if (!firstSeen.has(requestId)) remember(firstSeen, requestId, now);
      const verdict = latest.current.evaluate(agentId);
      if (verdict === "wait" && now - started < SETTLE_MS) return;
      const ok = verdict === "open";
      if (ok) latest.current.open(agentId);
      firstSeen.delete(requestId);
      remember(settled, requestId, ok);
      reply(requestId, ok);
    });
  }, [enabled]);
}
