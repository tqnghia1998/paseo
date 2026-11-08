import { createChiefDocumentBridge } from "./chief-documents";
import { pluginRegistry } from "@/plugins/registry";
import { createPluginNavigation } from "@/plugins/navigation";
import { useSyncExternalStore } from "react";
import { createChiefHandshake, type ChiefHandshake, type ChiefState } from "./chief-handshake";
import { isEmbeddedChiefView } from "./focus-mode";
import { getEmbeddedHostOrigin, subscribeToHostMessages } from "./host-messages";

// One handshake per frame, kept in module memory so a redirect back to `/?view=chief`
// keeps the bound session. It listens from module load: the host may post init as soon as
// the frame loads, before React mounts, and it re-sends until it sees ready or error.
let handshake: ChiefHandshake | null = null;

export function getChiefHandshake(): ChiefHandshake | null {
  if (handshake) return handshake;
  if (!isEmbeddedChiefView) return null;
  const origin = getEmbeddedHostOrigin();
  if (!origin) return null;
  handshake = createChiefHandshake({
    post: (message) => window.parent.postMessage(message, origin),
  });
  // Shared helper: only the actual parent window at the actual parent origin gets through.
  const current = handshake;
  const documentBridge = createChiefDocumentBridge({
    state: current.getState,
    post: (message) => window.parent.postMessage(message, origin),
    open: (serverId, workspaceId, path) => {
      const viewer = pluginRegistry
        .getSnapshot()
        .find((plugin) => plugin.serverId === serverId && plugin.id === "paseo-doc-viewer");
      if (!viewer?.surfaces.some((surface) => surface.id === "document")) return false;
      createPluginNavigation({ serverId, workspaceId }).openSurface(
        "paseo-doc-viewer",
        "document",
        { workspaceId, path },
      );
      return true;
    },
  });
  subscribeToHostMessages(origin, (data) => {
    current.receive(data);
    documentBridge(data);
  });
  return handshake;
}

const NO_STATE: ChiefState = { phase: "waiting", requestId: null, session: null, active: false };
const noSubscription = () => () => undefined;

export function useChiefState(): ChiefState {
  const current = getChiefHandshake();
  return useSyncExternalStore(
    current ? current.subscribe : noSubscription,
    current ? current.getState : () => NO_STATE,
    () => NO_STATE,
  );
}

if (isEmbeddedChiefView) getChiefHandshake();
