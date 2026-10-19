import { useEffect } from "react";
import { getEmbeddedHostOrigin, subscribeToHostMessages } from "./host-messages";
import type { ComposerAttachment } from "@/attachments/types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentAttachment, AgentSnapshotPayload } from "@getpaseo/protocol/messages";

export function getLiveDesignRewindText(message: string, attachments: AgentAttachment[]): string {
  const parts = [message];
  for (const attachment of attachments) {
    if (attachment.type === "text" && attachment.title === "Live Design context") {
      parts.push(attachment.text);
    }
  }
  return parts.join("\n\n");
}

export const EMBEDDED_LIVE_DESIGN_SEND_TYPE = "space:paseo-live-design-send";
export const EMBEDDED_LIVE_DESIGN_SENT_TYPE = "paseo:live-design-sent";
export const EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE = "paseo:live-design-completed";
export const EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE = "paseo:live-design-send-failed";
export const EMBEDDED_LIVE_DESIGN_READY_TYPE = "paseo:live-design-ready";
export const EMBEDDED_LIVE_DESIGN_READY_REQUEST_TYPE = "space:paseo-live-design-ready-request";
export const EMBEDDED_LIVE_DESIGN_NEW_AGENT_REQUEST_TYPE =
  "space:paseo-live-design-new-agent-request";
export const EMBEDDED_LIVE_DESIGN_COMPLETION_SYNC_REQUEST_TYPE =
  "space:paseo-live-design-completion-sync-request";
export const EMBEDDED_LIVE_DESIGN_COMPLETION_ACK_TYPE = "space:paseo-live-design-completion-ack";

export interface EmbeddedLiveDesignSendMessage {
  type: typeof EMBEDDED_LIVE_DESIGN_SEND_TYPE;
  requestId: string;
  text: string;
  contextText: string;
}

export function isEmbeddedLiveDesignSendMessage(
  data: unknown,
): data is EmbeddedLiveDesignSendMessage {
  if (!data || typeof data !== "object" || "images" in data || "imageGrant" in data) return false;
  const message = data as Partial<EmbeddedLiveDesignSendMessage>;
  return (
    message.type === EMBEDDED_LIVE_DESIGN_SEND_TYPE &&
    typeof message.requestId === "string" &&
    typeof message.text === "string" &&
    message.text.length > 0 &&
    typeof message.contextText === "string" &&
    message.contextText.length > 0
  );
}

interface StoredRequest {
  requestId: string;
  agentId: string;
  workspaceId?: string;
  outcome?: "succeeded" | "failed" | "unknown";
}

const newAgentReadyRequestIds = new Map<string, string>();

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
            typeof (item as StoredRequest).workspaceId === "string") &&
          ((item as StoredRequest).outcome === undefined ||
            ["succeeded", "failed", "unknown"].includes((item as StoredRequest).outcome!)),
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

export function shouldSettleLiveDesignTurn(
  status: "idle" | "error" | "permission" | "timeout",
  hasResolvedAgent: boolean,
  final: Pick<
    AgentSnapshotPayload,
    "status" | "activeTurn" | "pendingPermissions" | "lastError"
  > | null,
  waitError?: string | null,
): boolean {
  return (
    hasResolvedAgent &&
    final !== null &&
    (final.status === "idle" || final.status === "error") &&
    !final.activeTurn &&
    final.pendingPermissions.length === 0 &&
    ((status === "idle" && final.status === "idle") ||
      (status === "error" &&
        (final.status === "error" ||
          (Boolean(final.lastError?.trim()) && waitError === final.lastError))))
  );
}

export async function waitForLiveDesignTurn(
  client: Pick<DaemonClient, "waitForFinish">,
  agentId: string,
  hasResolvedAgent = true,
): Promise<"succeeded" | "failed" | "unknown" | null> {
  if (!hasResolvedAgent) return null;
  let waitForActive = true;
  for (;;) {
    const result = await client
      .waitForFinish(agentId, 0, {
        waitForActive,
        waitThroughPermission: true,
      })
      .catch(() => null);
    const final = result?.final;
    if (final?.status === "closed" && !final.activeTurn && final.pendingPermissions.length === 0)
      return "unknown";
    if (result && shouldSettleLiveDesignTurn(result.status, true, result.final, result.error))
      return result.status === "idle" ? "succeeded" : "failed";
    // A wait error is not a failed turn. Resume observation until the agent finishes.
    if (final?.status === "running" || final?.activeTurn || final?.pendingPermissions.length)
      waitForActive = false;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
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
  outcome?: StoredRequest["outcome"],
  destination?: { agentId: string; workspaceId: string; isDraft: boolean },
): void {
  window.parent.postMessage(
    {
      type,
      ...(requestId ? { requestId } : {}),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
      ...(type === EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE && outcome ? { outcome } : {}),
      ...(type === EMBEDDED_LIVE_DESIGN_READY_TYPE ? { preparedText: true } : {}),
      ...(type === EMBEDDED_LIVE_DESIGN_READY_TYPE && destination ? { destination } : {}),
    },
    targetOrigin,
  );
}

export function useEmbeddedLiveDesignActivation(input: {
  activateConversation: (agentId?: string, newAgent?: boolean) => string | null | void;
  enabled: boolean;
  workspaceId: string;
}): void {
  const { activateConversation, enabled, workspaceId } = input;
  useEffect(() => {
    if (!enabled) return;
    const expectedOrigin = getEmbeddedHostOrigin();
    if (!expectedOrigin) return;
    const handleMessage = (data: Record<string, unknown>) => {
      if (data.type === EMBEDDED_LIVE_DESIGN_READY_REQUEST_TYPE) {
        activateConversation();
        return;
      }
      if (data.type === EMBEDDED_LIVE_DESIGN_NEW_AGENT_REQUEST_TYPE) {
        const requestId = (data as { requestId?: unknown }).requestId;
        const agentId = activateConversation(undefined, true);
        if (typeof requestId === "string" && agentId) {
          newAgentReadyRequestIds.set(agentId, requestId);
        }
        return;
      }
      if (data.type === EMBEDDED_LIVE_DESIGN_COMPLETION_SYNC_REQUEST_TYPE) {
        for (const { requestId, outcome } of requestsForWorkspace("completed", workspaceId)) {
          publishResult(
            expectedOrigin,
            EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE,
            requestId,
            undefined,
            outcome,
          );
        }
        const pendingAgentId = requestsForWorkspace("pending", workspaceId)[0]?.agentId;
        if (pendingAgentId) activateConversation(pendingAgentId);
        return;
      }
      if (
        data.type === EMBEDDED_LIVE_DESIGN_COMPLETION_ACK_TYPE &&
        typeof (data as { requestId?: unknown }).requestId === "string"
      ) {
        forgetRequest("completed", (data as { requestId: string }).requestId);
        const pendingAgentId = requestsForWorkspace("pending", workspaceId)[0]?.agentId;
        if (pendingAgentId) activateConversation(pendingAgentId);
      }
    };
    return subscribeToHostMessages(expectedOrigin, handleMessage);
  }, [activateConversation, enabled, workspaceId]);
}

export function useEmbeddedLiveDesignSend(input: {
  agentId: string;
  enabled: boolean;
  isDraft?: boolean;
  submit: (
    text: string,
    onTurnFinished: (outcome?: StoredRequest["outcome"]) => Promise<void>,
    onAgentResolved: (agentId: string) => void,
    attachments: ComposerAttachment[],
  ) => Promise<void>;
  resumePending?: (
    onTurnFinished: (outcome?: StoredRequest["outcome"]) => Promise<void>,
  ) => Promise<void>;
  workspaceId?: string | null;
}): void {
  const { agentId, enabled, isDraft = false, submit, resumePending, workspaceId } = input;
  useEffect(() => {
    if (!enabled) return;
    const expectedOrigin = getEmbeddedHostOrigin();
    if (!expectedOrigin) return;
    const readyDestination = workspaceId ? { agentId, workspaceId, isDraft } : undefined;
    const handleMessage = (data: Record<string, unknown>) => {
      if (data !== null && typeof data === "object" && "type" in data) {
        if (
          data.type === EMBEDDED_LIVE_DESIGN_SEND_TYPE &&
          typeof data.requestId === "string" &&
          ("images" in data || "imageGrant" in data)
        ) {
          publishResult(
            expectedOrigin,
            EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE,
            data.requestId,
            "Live Design image handoff is no longer supported",
          );
          return;
        }
        if (data.type === EMBEDDED_LIVE_DESIGN_READY_REQUEST_TYPE) {
          publishResult(
            expectedOrigin,
            EMBEDDED_LIVE_DESIGN_READY_TYPE,
            undefined,
            undefined,
            undefined,
            readyDestination,
          );
          return;
        }
      }
      if (!isEmbeddedLiveDesignSendMessage(data)) return;
      const { text, contextText, requestId } = data;
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
        rememberRequest("pending", {
          ...pendingRequest,
          agentId: resolvedAgentId,
        });
      };
      const onTurnFinished = async (outcome: StoredRequest["outcome"] = "unknown") => {
        const pendingRequest =
          requests("pending").find((pending) => pending.requestId === requestId) ?? request;
        forgetRequest("pending", requestId);
        rememberRequest("completed", { ...pendingRequest, outcome });
        publishResult(
          expectedOrigin,
          EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE,
          requestId,
          undefined,
          outcome,
        );
      };
      void (async () => {
        await submit(text, onTurnFinished, onAgentResolved, [
          {
            kind: "text",
            attachment: {
              type: "text",
              mimeType: "text/plain",
              title: "Live Design context",
              text: contextText,
            },
          },
        ]);
      })()
        .then(() => publishResult(expectedOrigin, EMBEDDED_LIVE_DESIGN_SENT_TYPE, requestId))
        .catch((error) => {
          forgetRequest("pending", requestId);
          publishResult(expectedOrigin, EMBEDDED_LIVE_DESIGN_SEND_FAILED_TYPE, requestId, error);
        });
    };
    const unsubscribe = subscribeToHostMessages(expectedOrigin, handleMessage);
    if (resumePending) {
      for (const request of requests("pending").filter(
        (pending) =>
          pending.agentId === agentId &&
          (!workspaceId || !pending.workspaceId || pending.workspaceId === workspaceId),
      )) {
        void resumePending(async (outcome = "unknown") => {
          forgetRequest("pending", request.requestId);
          rememberRequest("completed", { ...request, outcome });
          publishResult(
            expectedOrigin,
            EMBEDDED_LIVE_DESIGN_COMPLETED_TYPE,
            request.requestId,
            undefined,
            outcome,
          );
        }).catch(() => undefined);
      }
    }
    const newAgentRequestId = newAgentReadyRequestIds.get(agentId);
    if (newAgentRequestId) {
      newAgentReadyRequestIds.delete(agentId);
      publishResult(
        expectedOrigin,
        EMBEDDED_LIVE_DESIGN_READY_TYPE,
        newAgentRequestId,
        undefined,
        undefined,
        readyDestination,
      );
    } else {
      publishResult(
        expectedOrigin,
        EMBEDDED_LIVE_DESIGN_READY_TYPE,
        undefined,
        undefined,
        undefined,
        readyDestination,
      );
    }
    return unsubscribe;
  }, [agentId, enabled, isDraft, resumePending, submit, workspaceId]);
}
