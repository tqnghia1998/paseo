import type { ChiefState } from "./chief-handshake";

interface DocumentBridgeDeps {
  state(): ChiefState;
  open(serverId: string, workspaceId: string, path: string): boolean;
  post(message: Record<string, unknown>): void;
}

/** Parent origin/source checks belong to subscribeToHostMessages. Bind each open to the session too. */
export function createChiefDocumentBridge(deps: DocumentBridgeDeps) {
  return (data: Record<string, unknown>) => {
    if (data.type !== "space:chief-open-document") return;
    const state = deps.state();
    const session = state.session;
    if (
      state.phase !== "ready" ||
      !session ||
      data.requestId !== state.requestId ||
      typeof data.id !== "string" ||
      data.id.length > 128
    )
      return;
    const validPath =
      typeof data.path === "string" &&
      data.path.length > 0 &&
      data.path.length <= 4096 &&
      !data.path.includes("\\") &&
      !Array.from(data.path).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) &&
      !/^(\/|[a-zA-Z]:)/.test(data.path) &&
      data.path.split("/").every((part) => part !== ".." && part !== "." && part !== "");
    let opened = false;
    if (validPath && data.root === session.cwd) {
      try {
        opened = deps.open(session.serverId, session.workspaceId, data.path as string);
      } catch {
        opened = false;
      }
    }
    deps.post({
      type: "paseo:chief-document-opened",
      requestId: state.requestId,
      id: data.id,
      outcome: opened ? "opened" : "unavailable",
    });
  };
}
