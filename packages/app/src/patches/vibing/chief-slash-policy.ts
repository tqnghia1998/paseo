import { isEmbeddedChiefView } from "./focus-mode";

/** Chief stays one conversation; side questions belong in ordinary Bot chats. */
export function isChiefSlashCommandAllowed(name: string, chiefView = isEmbeddedChiefView): boolean {
  return !chiefView || name.toLowerCase() !== "btw";
}

/** Consume blocked input before plugin dispatch, draft clearing, sending or queueing. */
export function rejectChiefSlashCommand(
  text: string,
  showError: (message: string) => void,
  chiefView = isEmbeddedChiefView,
): boolean {
  const command = /^\/([^\s]+)/.exec(text.trim())?.[1];
  if (!command || isChiefSlashCommandAllowed(command, chiefView)) return false;
  showError("/btw is disabled in Chief. Use a Bot chat for side questions.");
  return true;
}
