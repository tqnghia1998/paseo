import { expect, it } from "vitest";
import {
  MockPickerConfigSchema,
  parseMockPickerAddress,
  selectMockPickerModel,
} from "./mock-picker-protocol";

const selection = { provider: "claude", model: "sonnet", thinkingOptionId: "high" };
const config = () =>
  MockPickerConfigSchema.parse({
    type: "space:mock-picker-config",
    version: 1,
    requestId: "request-12345678901234567890",
    selection,
    harnesses: [
      {
        provider: "claude",
        label: "Claude",
        enabled: true,
        reason: "",
        models: [
          {
            id: "sonnet",
            label: "Sonnet",
            isDefault: true,
            thinkingOptions: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
            defaultThinkingOptionId: "low",
          },
        ],
      },
      {
        provider: "codex",
        label: "Codex",
        enabled: false,
        supportsMockPlanning: false,
        reason: "Not supported yet",
        models: [],
      },
    ],
  });
it("accepts only explicit loopback parents and a request-bound handshake", () => {
  expect(
    parseMockPickerAddress(
      "?parentOrigin=https%3A%2F%2Flocalhost%3A9001&requestId=request-12345678901234567890",
    )?.parentOrigin,
  ).toBe("https://localhost:9001");
  expect(
    parseMockPickerAddress(
      "?parentOrigin=https%3A%2F%2Fexample.com&requestId=request-12345678901234567890",
    ),
  ).toBeNull();
  expect(parseMockPickerAddress("?parentOrigin=https%3A%2F%2Flocalhost%3A9001")).toBeNull();
});
it("preserves the chosen effort and refuses disabled or unknown pairs", () => {
  expect(config().harnesses[1].supportsMockPlanning).toBe(false);
  expect(selectMockPickerModel(config(), "claude", "sonnet")).toEqual(selection);
  expect(selectMockPickerModel(config(), "codex", "gpt")).toBeNull();
  expect(selectMockPickerModel(config(), "claude", "unknown")).toBeNull();
});
it("uses a new model's own thinking default", () => {
  const input = config();
  input.selection = null;
  expect(selectMockPickerModel(input, "claude", "sonnet")).toEqual({
    provider: "claude",
    model: "sonnet",
    thinkingOptionId: "low",
  });
});
it("preserves Default when selecting the current model again", () => {
  const input = config();
  input.selection = { provider: "claude", model: "sonnet" };
  expect(selectMockPickerModel(input, "claude", "sonnet")).toEqual(input.selection);
});
