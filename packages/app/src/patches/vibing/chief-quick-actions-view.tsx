import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import {
  CHIEF_QUICK_ACTIONS,
  runChiefQuickAction,
  useChiefComposerReady,
  type ChiefQuickAction,
} from "./chief-quick-actions";

const styles = StyleSheet.create((theme) => ({
  root: {
    alignItems: "center",
    gap: theme.spacing[3],
    maxWidth: 520,
    paddingHorizontal: theme.spacing[4],
  },
  title: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
}));

function QuickActionChip({ action }: { action: ChiefQuickAction }) {
  const press = useCallback(() => {
    runChiefQuickAction(action);
  }, [action]);
  return (
    <Button variant="outline" size="sm" accessibilityLabel={action.label} onPress={press}>
      {action.label}
    </Button>
  );
}

/** Shown in place of the empty-transcript text, and only while the composer can send. */
export function ChiefQuickActions() {
  const ready = useChiefComposerReady();
  if (!ready) return null;
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Quick actions</Text>
      <View style={styles.row}>
        {CHIEF_QUICK_ACTIONS.map((action) => (
          <QuickActionChip key={action.id} action={action} />
        ))}
      </View>
    </View>
  );
}
