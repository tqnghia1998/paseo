import { getEmbeddedWorkspace, isEmbeddedWorkspaceAllowed } from "./workspace-boundary";
import type { ComposerAttachment } from "@/attachments/types";
import type { ComposerInputMode } from "@/composer/input-mode";
import type { AgentInputSubmitResult } from "@/composer/submit";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { isEmbeddedLiveDesignMessaging } from "./focus-mode";
import { useEmbeddedPromptInsert } from "./host-prompts";
import { useEmbeddedLiveDesignSend, waitForLiveDesignTurn } from "./live-design";

interface ComposerBridgeInput {
  enabled: boolean;
  agentId: string;
  workspaceId?: string | null;
  inputMode: ComposerInputMode;
  readOnly: boolean;
  isComposerLocked: boolean;
  client: Pick<DaemonClient, "waitForFinish"> | null;
  resolveLiveDesignAgentId?: () => string | undefined;
  getText: () => string;
  replaceText: (text: string) => void;
  focus: () => void;
  sendMessage: (
    text: string,
    attachments: ComposerAttachment[],
    forceSend?: boolean,
    onQueuedMessageSubmitted?: () => Promise<void>,
  ) => Promise<AgentInputSubmitResult>;
}

export function useEmbeddedComposerBridge(input: ComposerBridgeInput): void {
  const {
    enabled,
    agentId,
    workspaceId,
    inputMode,
    readOnly,
    isComposerLocked,
    client,
    resolveLiveDesignAgentId,
    getText,
    replaceText,
    focus,
    sendMessage,
  } = input;
  const bound = getEmbeddedWorkspace();
  const inWorkspace = !bound || isEmbeddedWorkspaceAllowed(bound.serverId, workspaceId);
  useEmbeddedPromptInsert({
    workspaceId,
    inputMode,
    readOnly,
    enabled: enabled && inWorkspace && !isComposerLocked,
    getText: useStableEvent(getText),
    replaceText,
    focus: useStableEvent(focus),
  });

  useEmbeddedLiveDesignSend({
    agentId,
    enabled: enabled && inWorkspace && isEmbeddedLiveDesignMessaging,
    isDraft: resolveLiveDesignAgentId !== undefined,
    workspaceId,
    submit: useStableEvent(
      async (
        text: string,
        onTurnFinished: (outcome?: "succeeded" | "failed" | "unknown") => Promise<void>,
        onAgentResolved: (agentId: string) => void,
        liveDesignAttachments: ComposerAttachment[],
      ) => {
        const waitForTurn = async () => {
          const resolvedDraftAgentId = resolveLiveDesignAgentId?.();
          const resolvedAgentId = resolvedDraftAgentId ?? agentId;
          onAgentResolved(resolvedAgentId);
          if (!client) return;
          const outcome = await waitForLiveDesignTurn(
            client,
            resolvedAgentId,
            resolveLiveDesignAgentId === undefined || Boolean(resolvedDraftAgentId),
          );
          if (outcome) await onTurnFinished(outcome);
        };
        const result = await sendMessage(text, liveDesignAttachments, undefined, waitForTurn);
        if (result === "failed" || result === "noop") {
          throw new Error("Paseo could not send the Live Design notes");
        }
        if (result === "submitted") {
          void waitForTurn().catch(() => undefined);
        }
      },
    ),
    resumePending: useStableEvent(
      async (onTurnFinished: (outcome?: "succeeded" | "failed" | "unknown") => Promise<void>) => {
        if (!client) return;
        const outcome = await waitForLiveDesignTurn(
          client,
          agentId,
          resolveLiveDesignAgentId === undefined,
        );
        if (outcome) await onTurnFinished(outcome);
      },
    ),
  });
}
