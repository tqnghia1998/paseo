import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Source-level guard, like focus-mode.test.tsx: the Chief frame must never offer the
// model/mode/feature controls. The daemon refuses user changes to Chief; this keeps the UI honest.
const composer = readFileSync(resolve(__dirname, "../../composer/index.tsx"), "utf8");

it("hides the agent controls in the Chief frame: its model and mode are owned by source", () => {
  // The panel locks the composer for the embedded Chief view and the composer drops the
  // controls; the daemon refuses user changes to a host-managed agent either way.
  expect(composer).toContain("showAgentControls: mode.showAgentControls && !configurationLocked,");
  expect(readFileSync(resolve(__dirname, "../../panels/agent-panel.tsx"), "utf8")).toContain(
    "configurationLocked={isEmbeddedChiefView}",
  );
});

it("keeps every client call that changes a session's model, mode or features inside the controls", () => {
  // These are the only callers; the controls are not rendered when `showAgentControls` is false.
  for (const [file, call] of [
    ["../../composer/agent-controls/index.tsx", "client.setAgentModel("],
    ["../../composer/agent-controls/index.tsx", "client.setAgentFeature("],
    ["../../composer/agent-controls/index.tsx", ".setAgentThinkingOption("],
    ["../../composer/agent-controls/mode-control.tsx", "setAgentMode("],
  ] as const) {
    expect(readFileSync(resolve(__dirname, file), "utf8")).toContain(call);
  }
});
