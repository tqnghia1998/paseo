import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import { generateDraftId } from "@/stores/draft-keys";

const BotChatForkContext = createContext<{
  createDraftId(): string;
  openDraft(draftId: string): void;
} | null>(null);

export function BotChatForkProvider({
  openDraft,
  draftIdPrefix,
  children,
}: {
  openDraft(draftId: string): void;
  draftIdPrefix?: string;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      createDraftId: () =>
        draftIdPrefix ? `${draftIdPrefix}:${generateDraftId()}` : generateDraftId(),
      openDraft,
    }),
    [draftIdPrefix, openDraft],
  );
  return <BotChatForkContext.Provider value={value}>{children}</BotChatForkContext.Provider>;
}

export function useBotChatFork() {
  return useContext(BotChatForkContext);
}
