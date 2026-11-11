import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ModelBrowser, useModelBrowser } from "@/components/model-browser";
import { SheetHeaderView } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { isWeb } from "@/constants/platform";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import {
  MockPickerConfigSchema,
  parseMockPickerAddress,
  selectMockPickerModel,
  type MockPickerConfig,
  type MockPickerSelection,
} from "./mock-picker-protocol";

function ThinkingMenuItem({
  option,
  selected,
  onSelect,
}: {
  option: { id: string; label: string };
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const select = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  return (
    <DropdownMenuItem selected={selected} showSelectedCheck onSelect={select}>
      {option.label}
    </DropdownMenuItem>
  );
}

function MockPickerControls({
  config,
  change,
  done,
}: {
  config: MockPickerConfig;
  change: (selection: MockPickerSelection) => void;
  done: () => void;
}) {
  const providers = useMemo<ProviderSelectorProvider[]>(
    () =>
      config.harnesses
        .filter((harness) => harness.supportsMockPlanning !== false)
        .map((harness) => ({
          id: harness.provider,
          label: harness.label,
          modelSelection: harness.enabled
            ? {
                kind: "models",
                rows: harness.models.map((model) => ({
                  favoriteKey: `${harness.provider}:${model.id}`,
                  provider: harness.provider,
                  providerLabel: harness.label,
                  modelId: model.id,
                  modelLabel: model.label,
                  description: model.id,
                  isDefault: model.isDefault,
                })),
              }
            : { kind: "error", message: harness.reason },
        })),
    [config.harnesses],
  );
  const browser = useModelBrowser({
    providers,
    selectedProvider: config.selection?.provider ?? "",
    selectedModel: config.selection?.model ?? "",
    isLoading: false,
  });
  const model = config.harnesses
    .find((harness) => harness.provider === config.selection?.provider)
    ?.models.find((candidate) => candidate.id === config.selection?.model);
  const options = useMemo(() => {
    const levels = (model?.thinkingOptions ?? []).map((option) => ({
      id: option.id,
      label: formatThinkingOptionLabel(option),
    }));
    return levels.length ? [{ id: "", label: "Default" }, ...levels] : [];
  }, [model]);
  const thinking = options.length
    ? {
        options,
        selectedId: config.selection?.thinkingOptionId ?? "",
        displayLabel:
          options.find((option) => option.id === (config.selection?.thinkingOptionId ?? ""))
            ?.label ?? "Default",
        onSelect: (thinkingOptionId: string) => {
          if (config.selection && options.some((option) => option.id === thinkingOptionId)) {
            const { provider, model: modelId } = config.selection;
            change({ provider, model: modelId, ...(thinkingOptionId ? { thinkingOptionId } : {}) });
          }
        },
      }
    : null;
  const unsupported = config.harnesses.filter((harness) => harness.supportsMockPlanning === false);
  const selectModel = useCallback(
    (provider: string, modelId: string) => {
      const selection = selectMockPickerModel(config, provider, modelId);
      if (selection) change(selection);
    },
    [change, config],
  );
  return (
    <View style={styles.root}>
      <SheetHeaderView header={browser.header} onClose={done} />
      <View style={styles.browser}>
        <ModelBrowser state={browser} scrolling="independent" onSelect={selectModel} />
      </View>
      {unsupported.length > 0 && (
        <Text style={styles.unsupported} numberOfLines={2}>
          Not supported for mock planning yet:{" "}
          {unsupported.map((harness) => harness.label).join(", ")}.
        </Text>
      )}
      <View style={styles.footer}>
        {thinking && (
          <View style={styles.thinking}>
            <Text style={styles.hint}>Thinking</Text>
            <DropdownMenu>
              <DropdownTrigger
                size="sm"
                accessibilityLabel={`Thinking effort: ${thinking.displayLabel}`}
              >
                {thinking.displayLabel}
              </DropdownTrigger>
              <DropdownMenuContent side="top" align="start" minWidth={160}>
                {thinking.options.map((option) => (
                  <ThinkingMenuItem
                    key={option.id}
                    option={option}
                    selected={option.id === thinking.selectedId}
                    onSelect={thinking.onSelect}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        )}
        {!options.length && (
          <Text style={styles.hint}>This model uses its default thinking settings.</Text>
        )}
        <Button size="sm" onPress={done}>
          Done
        </Button>
      </View>
    </View>
  );
}

// This framed entry has no agent, workspace selection or default-setting writes.
export function MockPicker() {
  const address = useMemo(
    () => (isWeb ? parseMockPickerAddress(window.location.search) : null),
    [],
  );
  const [config, setConfig] = useState<MockPickerConfig | null>(null);
  useEffect(() => {
    if (!isWeb || !address || window.parent === window) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== address.parentOrigin) return;
      if (event.data?.type !== "space:mock-picker-config") return;
      const parsed = MockPickerConfigSchema.safeParse(event.data);
      if (parsed.success && parsed.data.requestId === address.requestId) setConfig(parsed.data);
      else
        window.parent.postMessage(
          { type: "paseo:mock-picker-error", requestId: address.requestId },
          address.parentOrigin,
        );
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { type: "paseo:mock-picker-ready", version: 1, requestId: address.requestId },
      address.parentOrigin,
    );
    return () => window.removeEventListener("message", receive);
  }, [address]);
  useEffect(() => {
    if (isWeb && address && config)
      window.parent.postMessage(
        { type: "paseo:mock-picker-configured", version: 1, requestId: address.requestId },
        address.parentOrigin,
      );
  }, [address, config]);
  const change = useCallback(
    (selection: MockPickerSelection) => {
      if (!isWeb || !address || !config) return;
      setConfig({ ...config, selection });
      window.parent.postMessage(
        { type: "paseo:mock-picker-change", requestId: address.requestId, selection },
        address.parentOrigin,
      );
    },
    [address, config],
  );
  const done = useCallback(() => {
    if (isWeb && address)
      window.parent.postMessage(
        { type: "paseo:mock-picker-close", requestId: address.requestId },
        address.parentOrigin,
      );
  }, [address]);
  useKeyboardActionHandler({
    handlerId: "vibing-mock-picker-close",
    actions: ["agent.interrupt"],
    priority: 0,
    enabled: Boolean(address),
    handle: () => {
      if (!isWeb || !address) return false;
      window.parent.postMessage(
        { type: "paseo:mock-picker-close", requestId: address.requestId },
        address.parentOrigin,
      );
      return true;
    },
  });
  if (!isWeb || !address) return <Text>Model picker unavailable.</Text>;
  if (!config) return <View style={styles.root} />;
  return <MockPickerControls config={config} change={change} done={done} />;
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0, backgroundColor: theme.colors.background },
  browser: { flex: 1, minHeight: 0, padding: 8 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  thinking: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  unsupported: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
}));
