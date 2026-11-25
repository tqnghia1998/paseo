import {
  type PluginClientContext,
  type PluginTimelineItemProps,
  usePaseo,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { MAX_PROMPT_LENGTH, ROW_KIND } from "./shared/suggestions.js";

const schema = z.object({
  prompts: z.array(z.string().min(1).max(MAX_PROMPT_LENGTH)),
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  buttonBase: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
    minHeight: 30,
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 16,
  },
  disabled: { opacity: 0.55 },
  textBase: { flexShrink: 1, fontSize: 13 },
});

interface ChipProps {
  prompt: string;
  sending: boolean;
  colors: PluginTimelineItemProps["theme"]["colors"];
  onSend: (prompt: string) => void;
}

function SuggestionChip({ prompt, sending, colors, onSend }: ChipProps) {
  const [hovered, setHovered] = useState(false);
  const colorStyles = useMemo(
    () => ({
      // In Vibing's palette, surface2 (`control`) is the raised card and surface1 (`raised`) is the hover tone.
      resting: { borderColor: colors.border, backgroundColor: colors.surface2 },
      active: { backgroundColor: colors.surface1 },
      text: { color: colors.foreground },
    }),
    [colors.border, colors.foreground, colors.surface1, colors.surface2],
  );
  const iconColor = hovered && !sending ? colors.foreground : colors.foregroundMuted;
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const handlePress = useCallback(() => onSend(prompt), [onSend, prompt]);
  const resolveStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.buttonBase,
      colorStyles.resting,
      sending && styles.disabled,
      !sending && (hovered || pressed) && colorStyles.active,
    ],
    [colorStyles.active, colorStyles.resting, hovered, sending],
  );
  const textStyle = useMemo(() => [styles.textBase, colorStyles.text], [colorStyles.text]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Send: ${prompt}`}
      disabled={sending}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={resolveStyle}
    >
      <Icon name="ArrowUpRight" size={13} color={iconColor} />
      <Text style={textStyle}>{prompt}</Text>
    </Pressable>
  );
}

export default function contribute(client: PluginClientContext) {
  function Chips({ agentId, item, theme }: PluginTimelineItemProps<z.infer<typeof schema>>) {
    const paseo = usePaseo();
    const mountedRef = useRef(true);
    const [sendingPrompts, setSendingPrompts] = useState<ReadonlySet<string>>(() => new Set());

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    const sendPrompt = useCallback(
      (prompt: string) => {
        setSendingPrompts((prev) => {
          if (prev.has(prompt)) return prev;
          const next = new Set(prev);
          next.add(prompt);
          return next;
        });
        void paseo.agents
          .ref(agentId)
          .send(prompt)
          .catch(() => {})
          .finally(() => {
            if (!mountedRef.current) return;
            setSendingPrompts((prev) => {
              if (!prev.has(prompt)) return prev;
              const next = new Set(prev);
              next.delete(prompt);
              return next;
            });
          });
      },
      [agentId, paseo],
    );

    if (!item.data.prompts.length) return null;
    return (
      <View style={styles.row}>
        {item.data.prompts.map((prompt) => (
          <SuggestionChip
            key={prompt}
            prompt={prompt}
            sending={sendingPrompts.has(prompt)}
            colors={theme.colors}
            onSend={sendPrompt}
          />
        ))}
      </View>
    );
  }

  return client.addTimelineRenderer({ kind: ROW_KIND, version: 1, schema, Component: Chips });
}
