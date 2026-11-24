import {
  type PluginClientContext,
  type PluginTimelineItemProps,
  useAgent,
  useComposers,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { ROW_KIND } from "./shared/suggestions.js";

const schema = z.object({ prompts: z.array(z.string().min(1).max(120)).max(2) });
const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});

export default function contribute(client: PluginClientContext) {
  function Chips({ agentId, item, theme }: PluginTimelineItemProps<z.infer<typeof schema>>) {
    const agent = useAgent(agentId);
    const [composer] = useComposers({ agentId });
    const { colors } = theme;
    const disabled = !!composer?.prompt.length;
    const chipStyles = useMemo(
      () =>
        StyleSheet.create({
          button: {
            flexDirection: "row",
            alignItems: "center",
            maxWidth: "100%",
            minHeight: 32,
            gap: 6,
            paddingHorizontal: 9,
            paddingVertical: 5,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            opacity: disabled ? 0.55 : 1,
          },
          text: { color: colors.foreground, flexShrink: 1, fontSize: 13 },
        }),
      [colors.border, colors.foreground, disabled],
    );
    const choices = useMemo(
      () =>
        item.data.prompts.map((prompt) => ({
          prompt,
          fill: () => {
            const [current] = client.composers({ agentId });
            if (!current || current.prompt.length > 0) return;
            current.setPrompt(prompt);
            void current.focus().catch(() => {});
          },
        })),
      [agentId, item.data.prompts],
    );
    if (!choices.length || agent?.status !== "idle" || !composer) return null;
    return (
      <View style={styles.row}>
        {choices.map(({ prompt, fill }) => (
          <Pressable
            key={prompt}
            accessibilityRole="button"
            accessibilityLabel={`Draft: ${prompt}`}
            disabled={disabled}
            onPress={fill}
            style={chipStyles.button}
          >
            <Icon name="ArrowUpRight" size={14} color={colors.foregroundMuted} />
            <Text style={chipStyles.text}>{prompt}</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return client.addTimelineRenderer({ kind: ROW_KIND, version: 1, schema, Component: Chips });
}
