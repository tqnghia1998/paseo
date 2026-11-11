import { z } from "zod";

const id = z.string().min(1).max(200);
const thinkingOption = z.object({ id, label: z.string().max(500) });
export const MockPickerSelectionSchema = z.object({
  provider: id,
  model: id,
  thinkingOptionId: id.optional(),
});
export const MockPickerConfigSchema = z.object({
  type: z.literal("space:mock-picker-config"),
  version: z.literal(1),
  requestId: z.string().min(20).max(100),
  selection: MockPickerSelectionSchema.nullable(),
  harnesses: z
    .array(
      z.object({
        provider: id,
        label: z.string().max(500),
        enabled: z.boolean(),
        supportsMockPlanning: z.boolean().optional(),
        reason: z.string().max(2000),
        models: z
          .array(
            z.object({
              id,
              label: z.string().max(500),
              isDefault: z.boolean(),
              thinkingOptions: z.array(thinkingOption).max(30).optional(),
              defaultThinkingOptionId: id.optional(),
            }),
          )
          .max(2000),
      }),
    )
    .max(100),
});
export type MockPickerConfig = z.infer<typeof MockPickerConfigSchema>;
export type MockPickerSelection = z.infer<typeof MockPickerSelectionSchema>;

export function parseMockPickerAddress(search: string) {
  const params = new URLSearchParams(search);
  const parent = params.get("parentOrigin");
  const requestId = params.get("requestId");
  if (!parent || !requestId || !/^[\w-]{20,100}$/.test(requestId)) return null;
  try {
    const url = new URL(parent);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const http = url.protocol === "http:" || url.protocol === "https:";
    if (!loopback || !http || url.origin !== parent) return null;
    return { parentOrigin: parent, requestId };
  } catch {
    return null;
  }
}

export function selectMockPickerModel(
  config: MockPickerConfig,
  provider: string,
  modelId: string,
): MockPickerSelection | null {
  const harness = config.harnesses.find((item) => item.provider === provider && item.enabled);
  const model = harness?.models.find((item) => item.id === modelId);
  if (!model) return null;
  const sameModel = config.selection?.provider === provider && config.selection.model === modelId;
  const current = sameModel ? config.selection?.thinkingOptionId : undefined;
  const preservesEffort =
    sameModel &&
    (current === undefined || model.thinkingOptions?.some((option) => option.id === current));
  const thinkingOptionId = preservesEffort ? current : model.defaultThinkingOptionId;
  return { provider, model: modelId, ...(thinkingOptionId ? { thinkingOptionId } : {}) };
}
