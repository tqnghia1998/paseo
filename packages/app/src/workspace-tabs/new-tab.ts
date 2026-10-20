import { generateMessageId } from "@/types/stream";
import { workspaceNewTabTarget } from "@/patches/vibing/focus-mode";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import type { TerminalProfile } from "@getpaseo/protocol/messages";

export type NewTabSelection =
  | { kind: "target"; target: WorkspaceTab["target"] }
  | { kind: "agent" }
  | { kind: "terminal"; profile?: TerminalProfile }
  | { kind: "browser" };

export function createNewWorkspaceTab(): WorkspaceTab {
  const id = generateMessageId();
  return {
    tabId: `tab_${id}`,
    target: workspaceNewTabTarget(`draft_${id}`),
    createdAt: Date.now(),
  };
}
