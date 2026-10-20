import React, { createContext, useContext, type ReactNode } from "react";

const BotChatForkContext = createContext<((draftId: string) => void) | null>(null);

export function BotChatForkProvider({
  openDraft,
  children,
}: {
  openDraft(draftId: string): void;
  children: ReactNode;
}) {
  return <BotChatForkContext.Provider value={openDraft}>{children}</BotChatForkContext.Provider>;
}

export function useBotChatFork() {
  return useContext(BotChatForkContext);
}
