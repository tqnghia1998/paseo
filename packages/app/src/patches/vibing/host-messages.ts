import { isEmbeddedFocusMode } from "./focus-mode";

export function getEmbeddedHostOrigin(): string | null {
  if (!isEmbeddedFocusMode || typeof window === "undefined" || window.parent === window)
    return null;
  try {
    return document.referrer
      ? new URL(document.referrer).origin
      : (window.location.ancestorOrigins?.[0] ?? null);
  } catch {
    return null;
  }
}

export function subscribeToHostMessages(
  origin: string,
  receive: (data: Record<string, unknown>) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    if (
      event.source === window.parent &&
      event.origin === origin &&
      event.data !== null &&
      typeof event.data === "object"
    )
      receive(event.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

// Only readiness requests cross the Settings -> workspace remount. Sends still
// require the normal composer acknowledgement and never enter this buffer.
const settingsHandoffs = new Map<string, Record<string, unknown>>();
export function rememberSettingsHandoff(data: Record<string, unknown>): boolean {
  const type = data.type;
  if (type !== "space:paseo-live-design-ready-request") {
    if (
      type !== "space:paseo-prompt-ready-request" &&
      type !== "space:paseo-live-design-new-agent-request"
    )
      return false;
    if (typeof data.requestId !== "string" || !data.requestId) return false;
  }
  settingsHandoffs.set(type, data);
  return true;
}

export function takeSettingsHandoff(type: string): Record<string, unknown> | undefined {
  const request = settingsHandoffs.get(type);
  settingsHandoffs.delete(type);
  return request;
}
