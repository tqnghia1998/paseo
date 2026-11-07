import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { NativeBotChat } from "./bot-chat";
import { useChiefActivityReport } from "./chief-activity";
import { getChiefHandshake, useChiefState } from "./chief-host";
import type { ChiefHandshake } from "./chief-handshake";
import type { ChiefSession } from "./chief-session";
import { verifyChiefAgent } from "./chief-verify";

const styles = StyleSheet.create({
  root: { flex: 1 },
  notice: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
});

// Chief never starts, switches or forks chats: the agent is fixed by the verified session.
const ignoreSelectChat = () => undefined;
const rejectStart = () => Promise.reject(new Error("Chief cannot start new conversations."));

// Below the composer (100/200), which takes Escape while it has dictation to cancel or a turn
// to interrupt. Overlays run before the dispatcher, so Escape closes the popup only when idle.
export const CHIEF_CLOSE_KEYBOARD_PRIORITY = 0;

function ChiefNotice({ text }: { text: string }) {
  return (
    <View style={styles.notice}>
      <Text>{text}</Text>
    </View>
  );
}

function ChiefVerifier({
  session,
  requestId,
  handshake,
}: {
  session: ChiefSession;
  requestId: string;
  handshake: ChiefHandshake;
}) {
  const client = useHostRuntimeClient(session.serverId);
  const connected = useHostRuntimeIsConnected(session.serverId);
  useEffect(() => {
    if (!client || !connected) return;
    let cancelled = false;
    client
      .fetchAgent({ agentId: session.agentId })
      .then((result) => {
        if (cancelled) return;
        const failure = verifyChiefAgent(result?.agent, session);
        if (failure) handshake.failed(requestId, failure);
        else handshake.verified(requestId);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) handshake.failed(requestId, "unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [client, connected, handshake, requestId, session]);
  // The host shows the only loading text; this frame stays blank until the chat is ready.
  return <View style={styles.root} />;
}

function ChiefNativeChat({
  session,
  active,
  handshake,
}: {
  session: ChiefSession;
  active: boolean;
  handshake: ChiefHandshake;
}) {
  // Not a document listener: react-native-web's TextInput stops keydown propagation.
  useKeyboardActionHandler({
    handlerId: "vibing-chief-close",
    actions: ["agent.interrupt"],
    enabled: active,
    priority: CHIEF_CLOSE_KEYBOARD_PRIORITY,
    handle: () => {
      handshake.requestClose();
      return true;
    },
  });
  return (
    <View style={styles.root}>
      <NativeBotChat
        serverId={session.serverId}
        botId="vibing-chief"
        agentId={session.agentId}
        workspaceId={session.workspaceId}
        cwd={session.cwd}
        provider={session.provider}
        active={active}
        onSelectChat={ignoreSelectChat}
        onStart={rejectStart}
      />
    </View>
  );
}

export function ChiefEmbeddedChat() {
  const handshake = getChiefHandshake();
  const state = useChiefState();
  // From verification on, so the ready ack already carries the agent's activity. The handshake
  // posts nothing before ready, and this keeps reporting while the popup is hidden.
  useChiefActivityReport(state.session, handshake);
  if (!handshake) return <ChiefNotice text="Chief is unavailable." />;
  if (state.phase === "ready" && state.session) {
    return <ChiefNativeChat session={state.session} active={state.active} handshake={handshake} />;
  }
  if (state.phase === "verifying" && state.session && state.requestId) {
    return (
      <ChiefVerifier session={state.session} requestId={state.requestId} handshake={handshake} />
    );
  }
  if (state.phase === "failed") return <ChiefNotice text="Chief is unavailable." />;
  return <View style={styles.root} />;
}
