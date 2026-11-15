import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// The Bots plugin's `nativeTokens` colours text and icons on the host's surfaces. Every token derives from the theme
// colours by ONE expression for both modes (light differs from dark only in the palette's values, docs/theme-sites.md);
// the dark values are pinned so nothing can move them. Contrast of the light values is the controller's concern
// (palette-align report), not asserted here.
const source = readFileSync(
  new URL("../plugins/paseo-bots/client/paseo-bots.gen.ts", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "paseo-bots.js",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
function declaration(name) {
  const node = parsed.statements.find(
    (statement) =>
      (ts.isFunctionDeclaration(statement) && statement.name?.text === name) ||
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((d) => d.name.getText(parsed) === name)),
  );
  assert.ok(node, `Missing ${name}`);
  return node.getText(parsed);
}
const context = vm.createContext({ WeakMap, Math, parseFloat, parseInt, Number, String });
vm.runInContext(
  ["parseColor", "mix", "isDark", "cache", "nativeTokens"].map(declaration).join("\n"),
  context,
);
const nativeTokens = (colors) => context.nativeTokens({ ...colors });

// The theme plugin's colours as the Bots plugin sees them (plugins/space-app-vibing-theme: canvas, hover as `raised`,
// the raised card as `control`, text, subdued text, blue).
const LIGHT = {
  surface0: "#d6d8df",
  surface1: "#cbcdd3",
  surface2: "#e6e7ed",
  border: "#c1c2c7",
  foreground: "#343b59",
  foregroundMuted: "#4c505e",
  accent: "#395d99",
};
const DARK = {
  surface0: "#1d2125",
  surface1: "#2f363d",
  surface2: "#24292e",
  border: "#2b3137",
  foreground: "#f6f8fa",
  foregroundMuted: "#d1d5da",
  accent: "#79b8ff",
};

const nativeTokensSource = declaration("nativeTokens");

test("dark: every derived value is unchanged", () => {
  const t = nativeTokens(DARK);
  assert.equal(t.surfaceSidebar, "#1d2125");
  assert.equal(t.surfaceSidebarSelected, "#4a5057");
  assert.equal(t.surface3, "#3f4449");
  assert.equal(t.surface4, "#565b5f");
  assert.equal(t.foregroundSelected, "#fdfdfe");
  assert.equal(t.accentBright, "#cde5ff");
  assert.equal(t.foregroundExtraMuted, "#92969b");
  assert.equal(t.interactionHighlight, "rgba(255, 255, 255, 0.08)");
  assert.deepEqual(
    [t.statusDotRunning, t.statusDotSuccess, t.statusDotWarning, t.statusDotDanger],
    ["#5caaf6", "#35c264", "#db932e", "#f7796d"],
  );
});

test("light uses the same expression as dark for every derived value", () => {
  // Only the translucent highlight overlay is per mode (white over dark, black over light); nothing else branches.
  const branching = nativeTokensSource
    .split("\n")
    .filter((line) => /\bdark\b\s*\?/.test(line) && !line.includes("interactionHighlight"));
  assert.deepEqual(branching, []);
  const light = nativeTokens(LIGHT);
  const mixed = (a, b, w) => context.mix(a, b, w);
  assert.equal(light.surfaceSidebarSelected, mixed(LIGHT.surface1, LIGHT.foreground, 0.865));
  assert.equal(light.surface3, mixed(LIGHT.surface2, LIGHT.foreground, 0.87));
  assert.equal(light.surface4, mixed(LIGHT.surface2, LIGHT.foreground, 0.76));
  assert.equal(light.borderAccent, mixed(LIGHT.border, LIGHT.foreground, 0.95));
  assert.equal(light.foregroundExtraMuted, mixed(LIGHT.foregroundMuted, LIGHT.surface0, 0.65));
  assert.equal(light.foregroundSelected, mixed(LIGHT.foreground, "#ffffff", 0.25));
  assert.equal(light.accentBright, mixed(LIGHT.accent, "#ffffff", 0.37));
  assert.equal(light.interactionHighlight, "rgba(0, 0, 0, 0.06)");
  assert.deepEqual(
    [light.statusDotRunning, light.statusDotSuccess, light.statusDotWarning, light.statusDotDanger],
    ["#5caaf6", "#35c264", "#db932e", "#f7796d"],
  );
});

test("the list, tab strip and splash are the canvas in both modes", () => {
  assert.equal(nativeTokens(LIGHT).surfaceSidebar, LIGHT.surface0);
  assert.equal(nativeTokens(DARK).surfaceSidebar, DARK.surface0);
});

test("the tooltip bubble is the raised card in both modes", () => {
  assert.ok(/backgroundColor: theme \? theme\.surface2 : "#202225"/.test(source));
  assert.ok(!/dark \? theme\.surface2 : theme\.surface0/.test(source));
});

test("the muted badge is surface3 in both modes (no light-only fill)", () => {
  assert.ok(!source.includes("mutedBadgeFill"));
});
