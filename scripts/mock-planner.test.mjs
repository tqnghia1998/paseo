import assert from "node:assert/strict";
import test from "node:test";
import { createMockPlannerBridge } from "./mock-planner.mjs";

const catalog = async () =>
  ["claude", "codex", "opencode", "pi", "custom-pi", "custom-opencode"].map((provider) => ({
    provider,
    status: "ready",
    enabled: true,
    models: [
      {
        id: "model-one",
        label: "Model one",
        isDefault: true,
        thinkingOptions: [{ id: "high", label: "high" }],
      },
    ],
  }));
const providerOverrides = {
  "custom-pi": { extends: "pi" },
  "custom-opencode": { extends: "opencode" },
};

test("Mock System offers Pi and derived Pi harnesses without OpenCode entries", async () => {
  const bridge = createMockPlannerBridge({ catalog, providerOverrides });
  const entries = await bridge.list();
  assert.deepEqual(
    entries.map((item) => item.provider),
    ["claude", "codex", "pi", "custom-pi"],
  );
  assert.equal(
    entries.every((item) => item.enabled),
    true,
  );
});

test("Pi planning passes the selected model and effort into an ephemeral tool-free session", async () => {
  let created;
  let closed = false;
  const manager = {
    createAgent: async (config) => {
      created = config;
    },
    runAgent: async () => ({ finalText: '{"views":[]}' }),
    closeAgent: async () => {
      closed = true;
    },
    deleteAgentState: async () => {},
  };
  const bridge = createMockPlannerBridge({
    manager,
    catalog,
    providerOverrides,
    structured: async ({ caller }) => JSON.parse(await caller("Fixed rulebook")),
  });
  assert.deepEqual(
    await bridge.generate("request-one", {
      provider: "pi",
      model: "model-one",
      thinkingOptionId: "high",
      prompt: "Evidence",
      schema: {},
    }),
    { views: [] },
  );
  assert.equal(created.provider, "pi");
  assert.equal(created.model, "model-one");
  assert.equal(created.thinkingOptionId, "high");
  assert.equal(created.internal, true);
  assert.deepEqual(created.mcpServers, {});
  assert.deepEqual(created.providerOptions, { restrictToConfiguredMcp: true });
  assert.equal(created.toolPolicy, undefined);
  assert.equal(closed, true);
  await assert.rejects(
    bridge.generate("request-two", { provider: "opencode", model: "model-one" }),
    /unavailable/,
  );
});
