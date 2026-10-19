import { useEffect, useId } from "react";
import { getEmbeddedHostOrigin, subscribeToHostMessages } from "./host-messages";

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

export function useEmbeddedPromptActivation(input: {
  enabled: boolean;
  activateConversation: () => unknown;
}): void {
  const { enabled, activateConversation } = input;
  useEffect(() => {
    if (!enabled) return;
    const origin = getEmbeddedHostOrigin();
    if (!origin) return;
    const handleMessage = (data: Record<string, unknown>) => {
      if (data.type === READY_REQUEST && typeof data.requestId === "string" && data.requestId)
        activateConversation();
    };
    return subscribeToHostMessages(origin, handleMessage);
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
    const origin = getEmbeddedHostOrigin();
    if (!origin) return;
    const preparedRequests = new Set<string>();
    const handleMessage = (data: Record<string, unknown>) => {
      const { type, requestId } = data;
      if (typeof requestId !== "string" || !requestId) return;
      if (type === READY_REQUEST) {
        rememberRequest(preparedRequests, requestId);
        window.parent.postMessage({ type: READY, requestId, composerId }, origin);
        return;
      }
      if (
        type !== INSERT ||
        data.composerId !== composerId ||
        !preparedRequests.has(requestId) ||
        typeof data.text !== "string" ||
        !data.text
      )
        return;
      if (!deliveredRequests.has(requestId)) {
        const current = getText();
        replaceText(current ? `${current}\n\n${data.text}` : data.text);
        rememberRequest(deliveredRequests, requestId);
        focus();
      }
      window.parent.postMessage({ type: INSERTED, requestId }, origin);
    };
    return subscribeToHostMessages(origin, handleMessage);
  }, [enabled, workspaceId, inputMode, readOnly, composerId, getText, replaceText, focus]);
}
