import type { ClientSlashCommand } from "@/client-slash-commands";
import { getChiefHandshake } from "./chief-host";

/**
 * The composer's client slash commands, as they mean in the Chief frame. Everywhere else
 * "/clear" archives the agent and opens a draft and "/exit" archives it; Chief is one
 * fixed agent that cannot be archived or replaced from inside its frame (archiving it would
 * end Chief for good), so both go to the host instead. Always handled: nothing here may
 * fall through to the archive path.
 */
export function runChiefSlashCommand(command: ClientSlashCommand): void {
  const handshake = getChiefHandshake();
  if (command.kind === "replace-agent-with-draft") handshake?.requestRestart();
  else handshake?.requestClose();
}
