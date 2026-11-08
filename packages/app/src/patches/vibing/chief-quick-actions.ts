import { useEffect, useSyncExternalStore } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";

/**
 * Chips shown in an empty Chief chat for the things people ask most. A chip either sends
 * its text at once ("send") or fills the composer for the user to finish ("prefill"), for
 * requests that need a link or a name only they have. Text is English like the rest of the
 * frame; Chief answers in the user's language.
 */
export interface ChiefQuickAction {
  id: string;
  label: string;
  mode: "send" | "prefill";
  text: string;
}

export const CHIEF_QUICK_ACTIONS: readonly ChiefQuickAction[] = [
  {
    id: "overview",
    label: "What's open right now?",
    mode: "send",
    text: "Give me a short overview of my apps and open workspaces, and which of them have Bots working.",
  },
  {
    id: "review",
    label: "Review a merge request",
    mode: "prefill",
    text: "Review this merge request: ",
  },
  {
    id: "open-branch",
    label: "Open a branch",
    mode: "prefill",
    text: "Open the feature for the branch ",
  },
  {
    id: "commit",
    label: "Commit my changes",
    mode: "send",
    text: "Commit the changes in my current workspace.",
  },
  {
    id: "dev-server",
    label: "Start the dev server",
    mode: "send",
    text: "Start the dev server for my current workspace.",
  },
  {
    id: "handoffs",
    label: "How is handed-off work going?",
    mode: "send",
    text: "How is the work I handed off to Bots going?",
  },
];

interface ComposerActions {
  send(text: string): void;
  fill(text: string): void;
  focus(): void;
}

let current: ComposerActions | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** The one visible composer registers here; chips use it instead of a second send path. */
export function registerChiefComposer(actions: ComposerActions): () => void {
  current = actions;
  notify();
  return () => {
    if (current !== actions) return;
    current = null;
    notify();
  };
}

/** False when the composer cannot take input (locked, read-only, not mounted). */
export function useChiefComposerReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current !== null,
    () => false,
  );
}

export function runChiefQuickAction(action: ChiefQuickAction): boolean {
  if (!current) return false;
  if (action.mode === "send") current.send(action.text);
  else {
    current.fill(action.text);
    current.focus();
  }
  return true;
}

export function useChiefComposerActions(input: {
  enabled: boolean;
  send(text: string): void;
  fill(text: string): void;
  focus(): void;
}): void {
  const send = useStableEvent(input.send);
  const fill = useStableEvent(input.fill);
  const focus = useStableEvent(input.focus);
  const { enabled } = input;
  useEffect(() => {
    if (!enabled) return;
    return registerChiefComposer({ send, fill, focus });
  }, [enabled, send, fill, focus]);
}
