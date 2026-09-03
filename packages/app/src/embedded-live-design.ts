import { useEffect } from "react";
export const EMBEDDED_LIVE_DESIGN_SEND_TYPE = "space:paseo-live-design-send";
export const EMBEDDED_LIVE_DESIGN_SENT_TYPE = "paseo:live-design-sent";
export const EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE = "paseo:live-design-completed";
export const EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE = "paseo:live-design-send-failed";
export const EMBEDDED_LIVE_DESIGN_READY_TYPE = "paseo:live-design-ready";
export const EMBEDDED_LIVE_DESIGN_READY_REQUEST_TYPE = "space:paseo-live-design-ready-request";
export const EMBEDDED_LIVE_DESIGN_COMPLETION_SYNC_REQUEST_TYPE =
  "space:paseo-live-design-completion-sync-request";
export const EMBEDDED_LIVE_DESIGN_COMPLETION_ACK_TYPE = "space:paseo-live-design-completion-ack";

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
    "Apply this Live Design feedback. Follow the project instructions and frontend conventions, start directly with the referenced files and selectors, and preserve the existing design system. The user is actively reviewing changes live in the preview via HMR, so apply code edits directly without browser verification.",
    "",
    requests.join("\n\n"),
  ].join("\n");
}

interface StoredRequest {
  requestId: string;
  agentId: string;
  workspaceId?: string;
}

const requestStorageKey = (state: "completed" | "pending") => `paseo:live-design-${state}`;

const requests = (state: "completed" | "pending"): StoredRequest[] => {
  try {
    const stored = sessionStorage.getItem(requestStorageKey(state));
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          typeof (item as StoredRequest).requestId === "string" &&
          typeof (item as StoredRequest).agentId === "string" &&
          ((item as StoredRequest).workspaceId === undefined ||
            typeof (item as StoredRequest).workspaceId === "string"),
      )
      ? (parsed as StoredRequest[])
      : [];
  } catch {
    return [];
  }
};

const rememberRequest = (state: "completed" | "pending", request: StoredRequest) => {
  try {
    const existing = requests(state);
    if (!existing.some(({ requestId }) => requestId === request.requestId)) {
      sessionStorage.setItem(requestStorageKey(state), JSON.stringify([...existing, request]));
    }
  } catch {
    // Storage is optional; completion delivery still works in the active iframe.
  }
};

const forgetRequest = (state: "completed" | "pending", requestId: string) => {
  try {
    sessionStorage.setItem(
      requestStorageKey(state),
      JSON.stringify(requests(state).filter((request) => request.requestId !== requestId)),
    );
  } catch {
    // Storage is optional; completion delivery still works in the active iframe.
  }
};

const requestsForWorkspace = (
  state: "completed" | "pending",
  workspaceId: string,
): StoredRequest[] => requests(state).filter((request) => request.workspaceId === workspaceId);

const embeddingOrigin = (): string | null => {
  try {
    return document.referrer
      ? new URL(document.referrer).origin
      : (window.location.ancestorOrigins?.[0] ?? null);
  } catch {
    return null;
  }
};

export function shouldSettleLiveDesignTurn(
  status: "idle" | "error" | "permission" | "timeout",
  hasResolvedAgent: boolean,
): boolean {
  return status === "idle" || (status === "error" && hasResolvedAgent);
}

function publishResult(
  targetOrigin: string,
  type:
    | typeof EMBEDDED_LIVE_DESIGN_SENT_TYPE
    | typeof EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE
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

export function useEmbeddedLiveDesignActivation(input: {
  activateConversation: (agentId?: string) => void;
  enabled: boolean;
  workspaceId: string;
}): void {
  const { activateConversation, enabled, workspaceId } = input;
  useEffect(() => {
    if (
      process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS !== "true" ||
      !enabled ||
      window.parent === window
    )
      return;
    const expectedOrigin = embeddingOrigin();
    if (!expectedOrigin) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== expectedOrigin) return;
      if (event.data === null || typeof event.data !== "object" || !("type" in event.data)) {
        return;
      }
      if (event.data.type === EMBEDDED_LIVE_DESIGN_READY_REQUEST_TYPE) {
        activateConversation();
        return;
      }
      if (event.data.type === EMBEDDED_LIVE_DESIGN_COMPLETION_SYNC_REQUEST_TYPE) {
        for (const { requestId } of requestsForWorkspace("completed", workspaceId)) {
          publishResult(event.origin, EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE, requestId);
        }
        const pendingAgentId = requestsForWorkspace("pending", workspaceId)[0]?.agentId;
        if (pendingAgentId) activateConversation(pendingAgentId);
        return;
      }
      if (
        event.data.type === EMBEDDED_LIVE_DESIGN_COMPLETION_ACK_TYPE &&
        typeof (event.data as { requestId?: unknown }).requestId === "string"
      ) {
        forgetRequest("completed", (event.data as { requestId: string }).requestId);
        const pendingAgentId = requestsForWorkspace("pending", workspaceId)[0]?.agentId;
        if (pendingAgentId) activateConversation(pendingAgentId);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [activateConversation, enabled, workspaceId]);
}

export function useEmbeddedLiveDesignSend(input: {
  agentId: string;
  enabled: boolean;
  submit: (
    text: string,
    onTurnFinished: () => Promise<void>,
    onAgentResolved: (agentId: string) => void,
  ) => Promise<void>;
  resumePending?: (onTurnFinished: () => Promise<void>) => Promise<void>;
  workspaceId?: string | null;
}): void {
  const { agentId, enabled, submit, resumePending, workspaceId } = input;
  useEffect(() => {
    // The caller gates this hook on the preserved Live Design query; the build check is defense in depth.
    if (
      process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS !== "true" ||
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
      if (event.data !== null && typeof event.data === "object" && "type" in event.data) {
        if (event.data.type === EMBEDDED_LIVE_DESIGN_READY_REQUEST_TYPE) {
          publishResult(event.origin, EMBEDDED_LIVE_DESIGN_READY_TYPE);
          return;
        }
      }
      if (!isEmbeddedLiveDesignSendMessage(event.data)) return;
      const { notes, requestId } = event.data;
      const request: StoredRequest = {
        requestId,
        agentId,
        ...(workspaceId ? { workspaceId } : {}),
      };
      rememberRequest("pending", request);
      const onAgentResolved = (resolvedAgentId: string) => {
        const pendingRequest =
          requests("pending").find((pending) => pending.requestId === requestId) ?? request;
        forgetRequest("pending", requestId);
        rememberRequest("pending", { ...pendingRequest, agentId: resolvedAgentId });
      };
      const onTurnFinished = async () => {
        const pendingRequest =
          requests("pending").find((pending) => pending.requestId === requestId) ?? request;
        forgetRequest("pending", requestId);
        rememberRequest("completed", pendingRequest);
        publishResult(event.origin, EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE, requestId);
      };
      void submit(buildEmbeddedLiveDesignPrompt(notes), onTurnFinished, onAgentResolved)
        .then(() => publishResult(event.origin, EMBEDDED_LIVE_DESIGN_SENT_TYPE, requestId))
        .catch((error) => {
          forgetRequest("pending", requestId);
          publishResult(event.origin, EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE, requestId, error);
        });
    };
    window.addEventListener("message", handleMessage);
    if (resumePending) {
      for (const request of requests("pending").filter(
        (pending) =>
          pending.agentId === agentId &&
          (!workspaceId || !pending.workspaceId || pending.workspaceId === workspaceId),
      )) {
        void resumePending(async () => {
          forgetRequest("pending", request.requestId);
          rememberRequest("completed", request);
          publishResult(expectedOrigin, EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE, request.requestId);
        }).catch(() => undefined);
      }
    }
    publishResult(expectedOrigin, EMBEDDED_LIVE_DESIGN_READY_TYPE);
    return () => window.removeEventListener("message", handleMessage);
  }, [agentId, enabled, resumePending, submit, workspaceId]);
}
