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

test("Mock System retains valid context-window metadata for the exact selected model", async () => {
  const bridge = createMockPlannerBridge({
    providerOverrides: {},
    catalog: async () => [
      {
        provider: "codex",
        status: "ready",
        enabled: true,
        models: [
          { id: "large", label: "Large", contextWindowMaxTokens: 256000 },
          { id: "invalid", label: "Invalid", contextWindowMaxTokens: -1 },
        ],
      },
    ],
  });
  const entries = await bridge.list();
  assert.equal(entries[0].models[0].contextWindowMaxTokens, 256000);
  assert.equal(entries[0].models[1].contextWindowMaxTokens, undefined);
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

test("planner progress preserves partial strings, nested purposes and unresolved needs", async () => {
  const examples = [
    {
      source: '{"views":[{"title":"Draft \\"quoted\\" \\u4e2',
      expected: [{ id: "view-0", role: "assistant", text: 'Draft "quoted"' }],
    },
    {
      source: JSON.stringify({
        views: [
          { title: "First", cases: [{ purpose: "Open\npanel" }] },
          { title: "Second", cases: [{ purpose: " " }] },
        ],
        unresolved: [{ file: "src/Page.tsx", reason: "Needs setup" }],
      }),
      expected: [
        { id: "view-0", role: "assistant", text: "First\nOpen\npanel" },
        { id: "view-1", role: "assistant", text: "Second" },
        {
          id: "unresolved",
          role: "assistant",
          text: "Unresolved needs\nsrc/Page.tsx: Needs setup",
        },
      ],
    },
    {
      source: '{"views":[{"title":"Kept"},{"title":"bad\\q"}]}',
      expected: [{ id: "view-0", role: "assistant", text: "Kept" }],
    },
  ];
  for (const { source, expected } of examples) {
    const progress = [];
    const manager = {
      createAgent: async () => {},
      runAgent: async () => ({
        finalText: "{}",
        timeline: [{ type: "assistant_message", text: source }],
      }),
      closeAgent: async () => {},
      deleteAgentState: async () => {},
    };
    const bridge = createMockPlannerBridge({
      manager,
      catalog,
      providerOverrides,
      structured: async ({ caller }) => JSON.parse(await caller("Fixed rulebook")),
    });
    await bridge.generate(
      "progress",
      { provider: "codex", model: "model-one", prompt: "Evidence", schema: {} },
      (event) => progress.push(event),
    );
    assert.deepEqual(progress, expected);
  }
});
