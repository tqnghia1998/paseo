import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Chief uses the same conversation controls as ordinary chats.
const composer = readFileSync(resolve(__dirname, "../../composer/index.tsx"), "utf8");

it("keeps the normal composer controls available in the Chief frame", () => {
  expect(composer).not.toContain("configurationLocked");
  expect(readFileSync(resolve(__dirname, "../../panels/agent-panel.tsx"), "utf8")).not.toContain(
    "configurationLocked={isEmbeddedChiefView}",
  );
});

it("keeps every client call that changes a session's model, mode or features inside the controls", () => {
  // Model, mode, thinking and features use the ordinary session setters.
  for (const [file, call] of [
    ["../../composer/agent-controls/index.tsx", "client.setAgentModel("],
    ["../../composer/agent-controls/index.tsx", "client.setAgentOptions("],
    ["../../composer/agent-controls/index.tsx", ".setAgentThinkingOption("],
    ["../../composer/agent-controls/mode-control.tsx", "setAgentMode("],
  ] as const) {
    expect(readFileSync(resolve(__dirname, file), "utf8")).toContain(call);
  }
});
