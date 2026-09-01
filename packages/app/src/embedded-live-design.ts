import { useEffect } from "react";
export const EMBEDDED_LIVE_DESIGN_SEND_TYPE = "space:paseo-live-design-send";
export const EMBEDDED_LIVE_DESIGN_SENT_TYPE = "paseo:live-design-sent";
export const EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE = "paseo:live-design-send-failed";
export const EMBEDDED_LIVE_DESIGN_READY_TYPE = "paseo:live-design-ready";
export const EMBEDDED_LIVE_DESIGN_READY_REQUEST_TYPE = "space:paseo-live-design-ready-request";

export interface EmbeddedLiveDesignNote {
  comment: string;
  context?: {
    accessibleName?: string;
    selector?: string;
    url?: string;
    viewport?: { width: number; height: number };
    source?: {
      filePath?: string;
      lineNumber?: number;
      columnNumber?: number;
    };
  };
}

export interface EmbeddedLiveDesignSendMessage {
  type: typeof EMBEDDED_LIVE_DESIGN_SEND_TYPE;
  requestId: string;
  notes: EmbeddedLiveDesignNote[];
}

export function isEmbeddedLiveDesignSendMessage(
  data: unknown,
): data is EmbeddedLiveDesignSendMessage {
  if (!data || typeof data !== "object") return false;
  const message = data as Partial<EmbeddedLiveDesignSendMessage>;
  return (
    message.type === EMBEDDED_LIVE_DESIGN_SEND_TYPE &&
    typeof message.requestId === "string" &&
    Array.isArray(message.notes) &&
    message.notes.length > 0 &&
    message.notes.every(
      (note) => note !== null && typeof note === "object" && typeof note.comment === "string",
    )
  );
}

export function buildEmbeddedLiveDesignPrompt(notes: EmbeddedLiveDesignNote[]): string {
  const requests = notes.map((note, index) => {
    const source = note.context?.source;
    const file = source?.filePath
      ? [source.filePath, source.lineNumber, source.columnNumber]
          .filter((part) => part !== undefined)
          .join(":")
      : undefined;
    return [
      `# Request ${index + 1}`,
      "",
      `- Comment: ${note.comment}`,
      ...(file ? [`- File: ${file}`] : []),
      ...(note.context?.url ? [`- Page: ${note.context.url}`] : []),
      ...(note.context?.viewport
        ? [`- Viewport: ${note.context.viewport.width} × ${note.context.viewport.height}`]
        : []),
      ...(note.context?.selector ? [`- Selector: ${note.context.selector}`] : []),
      ...(note.context?.accessibleName
        ? [`- Accessible name: ${note.context.accessibleName}`]
        : []),
    ].join("\n");
  });
  return [
    "Apply this Live Design feedback.",
    "",
    "- Read the project instructions and use a relevant UI/UX or frontend skill when available.",
    "- Start with the referenced files and selectors.",
    "- Make only the requested changes.",
    "- Preserve the existing architecture and design system.",
    "- Do not browse to verify the supplied page.",
    "- Do not run builds or tests.",
    "- Do not make unrelated refactors.",
    "",
    requests.join("\n\n"),
  ].join("\n");
}

const embeddingOrigin = (): string | null => {
  try {
    return document.referrer
      ? new URL(document.referrer).origin
      : (window.location.ancestorOrigins?.[0] ?? null);
  } catch {
    return null;
  }
};

function publishResult(
  targetOrigin: string,
  type:
    | typeof EMBEDDED_LIVE_DESIGN_SENT_TYPE
    | typeof EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE
    | typeof EMBEDDED_LIVE_DESIGN_READY_TYPE,
  requestId?: string,
  error?: unknown,
): void {
  window.parent.postMessage(
    {
      type,
      ...(requestId ? { requestId } : {}),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    },
    targetOrigin,
  );
}

export function useEmbeddedLiveDesignSend(input: {
  enabled: boolean;
  submit: (text: string) => Promise<void>;
}): void {
  const { enabled, submit } = input;
  useEffect(() => {
    // The router replaces the embed URL with /h/... after opening its folder.
    // Build mode, not the transient query string, identifies this standalone iframe.
    if (
      process.env.EXPO_PUBLIC_PASEO_EMBEDDED_CHAT_ONLY !== "true" ||
      !enabled ||
      window.parent === window
    )
      return;
    const expectedOrigin = embeddingOrigin();
    if (!expectedOrigin) return;
    const isTrustedHost = (event: MessageEvent) =>
      event.source === window.parent && event.origin === expectedOrigin;
    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedHost(event)) return;
      if (
        event.data !== null &&
        typeof event.data === "object" &&
        "type" in event.data &&
        event.data.type === EMBEDDED_LIVE_DESIGN_READY_REQUEST_TYPE
      ) {
        publishResult(event.origin, EMBEDDED_LIVE_DESIGN_READY_TYPE);
        return;
      }
      if (!isEmbeddedLiveDesignSendMessage(event.data)) return;
      const { notes, requestId } = event.data;
      void submit(buildEmbeddedLiveDesignPrompt(notes))
        .then(() => publishResult(event.origin, EMBEDDED_LIVE_DESIGN_SENT_TYPE, requestId))
        .catch((error) =>
          publishResult(event.origin, EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE, requestId, error),
        );
    };
    window.addEventListener("message", handleMessage);
    publishResult(expectedOrigin, EMBEDDED_LIVE_DESIGN_READY_TYPE);
    return () => window.removeEventListener("message", handleMessage);
  }, [enabled, submit]);
}
