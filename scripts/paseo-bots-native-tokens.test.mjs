import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// The Bots plugin's `nativeTokens` colours text and icons on the host's light and dark surfaces.
// Every light value is checked for contrast on the surfaces it sits on (the Space App Vibing light
// palette: canvas, raised, hover and the selected tone `nativeTokens` derives), and the dark values
// are pinned so a light fix cannot move them.
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

// Light: docs/theme.md (canvas #d6d8df, raised #e6e7ed, hover #cbd1df, text #343b59, subdued #4c505e).
const LIGHT = {
  surface0: "#d6d8df",
  surface1: "#cbd1df",
  surface2: "#e6e7ed",
  border: "#c1c2c7",
  foreground: "#343b59",
  foregroundMuted: "#4c505e",
  accent: "#395d99",
};
// Dark: Desktop Plus palette.
const DARK = {
  surface0: "#1d2125",
  surface1: "#2f363d",
  surface2: "#24292e",
  border: "#2b3137",
  foreground: "#f6f8fa",
  foregroundMuted: "#d1d5da",
  accent: "#79b8ff",
};

function luminance(hex) {
  const channel = (i) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("light: selected text is the foreground and readable on the selected pill and row", () => {
  const t = nativeTokens(LIGHT);
  assert.equal(t.foregroundSelected, LIGHT.foreground);
  // The pill and the selected row use surfaceSidebarSelected; the old 75% white was 1.14:1 there.
  assert.ok(contrast(t.foregroundSelected, t.surfaceSidebarSelected) >= 4.5);
  assert.ok(contrast(t.foregroundSelected, LIGHT.surface0) >= 4.5);
});

test("dark: selected text and the other pinned dark values are unchanged", () => {
  const t = nativeTokens(DARK);
  assert.equal(t.foregroundSelected, "#fdfdfe");
  assert.equal(t.accentBright, "#cde5ff");
  assert.equal(t.foregroundExtraMuted, "#92969b");
  assert.equal(t.surface4, "#565b5f");
  assert.deepEqual(
    [t.statusDotRunning, t.statusDotSuccess, t.statusDotWarning, t.statusDotDanger],
    ["#5caaf6", "#35c264", "#db932e", "#f7796d"],
  );
});

test("light: text tokens keep 4.5:1 on every light surface they sit on", () => {
  const t = nativeTokens(LIGHT);
  const surfaces = [LIGHT.surface0, LIGHT.surface2, LIGHT.surface1, t.surfaceSidebarSelected];
  for (const surface of surfaces) {
    assert.ok(contrast(t.foregroundExtraMuted, surface) >= 4.5, `extra muted on ${surface}`);
    assert.ok(contrast(t.accentBright, surface) >= 4.5, `link on ${surface}`);
  }
  // Placeholder text sits in inputs on the canvas or on raised.
  for (const surface of [LIGHT.surface0, LIGHT.surface2]) {
    assert.ok(contrast(t.surface4, surface) >= 4.5, `placeholder on ${surface}`);
  }
});

test("light: status dots keep 3:1 on every light surface", () => {
  const t = nativeTokens(LIGHT);
  const surfaces = [LIGHT.surface0, LIGHT.surface2, LIGHT.surface1, t.surfaceSidebarSelected];
  for (const surface of surfaces) {
    for (const key of [
      "statusDotRunning",
      "statusDotSuccess",
      "statusDotWarning",
      "statusDotDanger",
    ]) {
      assert.ok(contrast(t[key], surface) >= 3, `${key} on ${surface}`);
    }
  }
});

test("only the generated plugin carries these light constants", () => {
  // The patch is the source of truth; the dark branch of every changed token keeps its old expression.
  assert.ok(
    /foregroundSelected: dark \? mix\(colors2\.foreground, "#ffffff", 0\.25\) : colors2\.foreground/.test(
      source,
    ),
  );
  assert.ok(
    /accentBright: dark \? mix\(colors2\.accent, "#ffffff", 0\.37\) : mix\(colors2\.accent, "#000000", 0\.85\)/.test(
      source,
    ),
  );
});
