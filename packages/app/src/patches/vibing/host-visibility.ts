import { useEffect, useState } from "react";
import { isWeb } from "@/constants/platform";
import { getEmbeddedHostOrigin, subscribeToHostMessages } from "./host-messages";

/** Host visibility changes only presentation/subscriptions, never agent execution. */
export function useEmbeddedHostActive(): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!isWeb) return;
    const origin = getEmbeddedHostOrigin();
    if (!origin) return;
    const unsubscribe = subscribeToHostMessages(origin, (data) => {
      if (data.type === "space:paseo-view-visibility" && typeof data.active === "boolean")
        setActive(data.active);
    });
    // Loading and Settings -> chat remounts can occur after the host's initial message.
    window.parent.postMessage({ type: "paseo:view-visibility-request" }, origin);
    return unsubscribe;
  }, []);
  return active;
}
