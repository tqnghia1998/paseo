import { useEffect, useId } from "react";
import { isEmbeddedFocusMode } from "./embedded-focus-mode";

const READY_REQUEST = "space:paseo-prompt-ready-request";
const READY = "paseo:prompt-ready";
const INSERT = "space:paseo-prompt-insert";
const INSERTED = "paseo:prompt-inserted";
// Retain delivery knowledge across composer switches in this iframe.
const deliveredRequests = new Set<string>();
const MAX_RECENT_REQUESTS = 1024;
function rememberRequest(requests: Set<string>, id: string): void {
  requests.add(id);
  if (requests.size > MAX_RECENT_REQUESTS) requests.delete(requests.values().next().value!);
}

function hostOrigin(): string | null {
  if (!isEmbeddedFocusMode || window.parent === window) return null;
  try {
    return document.referrer
      ? new URL(document.referrer).origin
      : (window.location.ancestorOrigins?.[0] ?? null);
  } catch {
    return null;
  }
}

function isHostMessage(event: MessageEvent, origin: string): boolean {
  return (
    event.source === window.parent &&
    event.origin === origin &&
    event.data !== null &&
    typeof event.data === "object"
  );
}

export function useEmbeddedPromptActivation(input: {
  enabled: boolean;
  activateConversation: () => unknown;
}): void {
  const { enabled, activateConversation } = input;
  useEffect(() => {
    if (!enabled) return;
    const origin = hostOrigin();
    if (!origin) return;
    const handleMessage = (event: MessageEvent) => {
      if (
        isHostMessage(event, origin) &&
        event.data.type === READY_REQUEST &&
        typeof event.data.requestId === "string" &&
        event.data.requestId
      )
        activateConversation();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [enabled, activateConversation]);
}

export function useEmbeddedPromptInsert(input: {
  enabled: boolean;
  workspaceId?: string | null;
  inputMode: "chat" | "terminal";
  readOnly: boolean;
  getText: () => string;
  replaceText: (text: string) => void;
  focus: () => void;
}): void {
  const { enabled, workspaceId, inputMode, readOnly, getText, replaceText, focus } = input;
  const composerId = useId();
  useEffect(() => {
    if (!enabled || !workspaceId || inputMode !== "chat" || readOnly) return;
    const origin = hostOrigin();
    if (!origin) return;
    const preparedRequests = new Set<string>();
    const handleMessage = (event: MessageEvent) => {
      if (!isHostMessage(event, origin)) return;
      const { type, requestId } = event.data;
      if (typeof requestId !== "string" || !requestId) return;
      if (type === READY_REQUEST) {
        rememberRequest(preparedRequests, requestId);
        window.parent.postMessage({ type: READY, requestId, composerId }, origin);
        return;
      }
      if (
        type !== INSERT ||
        event.data.composerId !== composerId ||
        !preparedRequests.has(requestId) ||
        typeof event.data.text !== "string" ||
        !event.data.text
      )
        return;
      if (!deliveredRequests.has(requestId)) {
        const current = getText();
        replaceText(current ? `${current}\n\n${event.data.text}` : event.data.text);
        rememberRequest(deliveredRequests, requestId);
        focus();
      }
      window.parent.postMessage({ type: INSERTED, requestId }, origin);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [enabled, workspaceId, inputMode, readOnly, composerId, getText, replaceText, focus]);
}
