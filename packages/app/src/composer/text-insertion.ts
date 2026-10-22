interface ComposerTarget {
  serverId: string;
  agentId: string;
}

const composers = new Map<string, (text: string) => void>();
const key = ({ serverId, agentId }: ComposerTarget) => JSON.stringify([serverId, agentId]);

export function registerComposerTextInsertion(
  target: ComposerTarget,
  insert: (text: string) => void,
): () => void {
  const id = key(target);
  composers.set(id, insert);
  return () => {
    if (composers.get(id) === insert) composers.delete(id);
  };
}

export function insertComposerText(input: ComposerTarget & { text: string }): void {
  if (typeof input.text !== "string" || !input.text.trim())
    throw new Error("Prompt text must not be empty");
  const insert = composers.get(key(input));
  if (!insert) throw new Error("Open this chat's editable composer before inserting a prompt");
  insert(input.text);
}

export interface ComposerDraft {
  agentId: string;
  workspaceId: string;
  send(text: string): Promise<void>;
}

const drafts = new Map<string, ComposerDraft & { serverId: string }>();
const draftListeners = new Set<() => void>();

export function registerComposerDraft(serverId: string, draft: ComposerDraft): () => void {
  const id = key({ serverId, agentId: draft.agentId });
  const entry = { ...draft, serverId };
  drafts.set(id, entry);
  for (const listener of draftListeners) listener();
  return () => {
    if (drafts.get(id) !== entry) return;
    drafts.delete(id);
    for (const listener of draftListeners) listener();
  };
}

export function observeComposerDrafts(
  serverId: string,
  listener: (drafts: readonly ComposerDraft[]) => void,
): () => void {
  const notify = () =>
    listener([...drafts.values()].filter((draft) => draft.serverId === serverId));
  draftListeners.add(notify);
  notify();
  return () => {
    draftListeners.delete(notify);
  };
}
