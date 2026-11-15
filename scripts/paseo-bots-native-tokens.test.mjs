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
  ["parseColor", "mix", "lift", "isDark", "cache", "nativeTokens"].map(declaration).join("\n"),
  context,
);
const nativeTokens = (colors) => context.nativeTokens({ ...colors });

// The theme plugin's colours as the Bots plugin sees them (plugins/space-app-vibing-theme: canvas, hover as `raised`,
// the raised card as `control`, text, subdued text, blue) plus the host's faint text (`ring`) as foregroundExtraMuted.
const DARK = {
  surface0: "#1d2125",
  surface1: "#2f363d",
  surface2: "#24292e",
  border: "#2b3137",
  foreground: "#f6f8fa",
  foregroundMuted: "#d1d5da",
  accent: "#79b8ff",
  foregroundExtraMuted: "#959da5",
};
// Two light sets: the current primitives and the target ones (raised `#dddfe5`, hover `#e3e4ea`).
const LIGHT = {
  surface0: "#d6d8df",
  surface1: "#cbcdd3",
  surface2: "#e6e7ed",
  border: "#c1c2c7",
  foreground: "#343b59",
  foregroundMuted: "#4c505e",
  accent: "#395d99",
  foregroundExtraMuted: "#686a77",
};
const LIGHT_TARGET = { ...LIGHT, surface1: "#e3e4ea", surface2: "#dddfe5" };
const SELECTED_PRIMITIVE = { dark: "#444d56", light: "#c6c9cf" };

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
const drift = (a, b) =>
  Math.max(
    ...[1, 3, 5].map((i) =>
      Math.abs(Number.parseInt(a.slice(i, i + 2), 16) - Number.parseInt(b.slice(i, i + 2), 16)),
    ),
  );

const nativeTokensSource = declaration("nativeTokens");

test("dark: every derived value stays within 2/255 of the values that shipped before", () => {
  const t = nativeTokens(DARK);
  const before = {
    surfaceSidebar: "#1d2125",
    surfaceSidebarSelected: "#4a5057",
    surface3: "#3f4449",
    surface4: "#565b5f",
    foregroundSelected: "#fdfdfe",
    accentBright: "#cde5ff",
  };
  for (const [key, value] of Object.entries(before)) {
    assert.ok(drift(t[key], value) <= 2, `${key} ${t[key]} vs ${value}`);
  }
  // The unchanged expressions are exact.
  assert.equal(t.surfaceSidebarSelected, "#4a5057");
  assert.equal(t.surface3, "#3f4449");
  assert.equal(t.surface4, "#565b5f");
  assert.equal(t.interactionHighlight, "rgba(255, 255, 255, 0.08)");
  // Faint text and the status dots are the host's own values.
  assert.equal(t.foregroundExtraMuted, "#959da5");
  assert.deepEqual(
    [t.statusDotRunning, t.statusDotSuccess, t.statusDotWarning, t.statusDotDanger],
    ["#5caaf6", "#35c264", "#db932e", "#f7796d"],
  );
});

test("one expression per token in both modes (only the highlight overlay branches on dark)", () => {
  const branching = nativeTokensSource
    .split("\n")
    .filter((line) => /\bdark\b\s*\?/.test(line) && !line.includes("interactionHighlight"));
  assert.deepEqual(branching, []);
  for (const colors of [LIGHT, LIGHT_TARGET]) {
    const light = nativeTokens(colors);
    assert.equal(
      light.surfaceSidebarSelected,
      context.mix(colors.surface1, colors.foreground, 0.865),
    );
    assert.equal(light.foregroundSelected, context.lift(colors.foreground, colors.surface0, 0.03));
    assert.equal(light.interactionHighlight, "rgba(0, 0, 0, 0.06)");
  }
});

test("light: selected text, links and faint text keep their floors on every surface they are drawn on", () => {
  for (const colors of [LIGHT, LIGHT_TARGET]) {
    const t = nativeTokens(colors);
    const surfaces = [
      colors.surface0,
      colors.surface2,
      colors.surface1,
      t.surfaceSidebarSelected,
      SELECTED_PRIMITIVE.light,
    ];
    for (const surface of surfaces) {
      assert.ok(contrast(t.accentBright, surface) >= 4.5, `link ${t.accentBright} on ${surface}`);
      assert.ok(
        contrast(t.foregroundExtraMuted, surface) >= 3 ||
          (colors === LIGHT && surface === t.surfaceSidebarSelected),
        `faint on ${surface}`,
      );
    }
    for (const surface of [colors.surface0, t.surfaceSidebarSelected, SELECTED_PRIMITIVE.light]) {
      assert.ok(contrast(t.foregroundSelected, surface) >= 4.5, `selected text on ${surface}`);
    }
  }
});

test("dark: links and selected text keep their floors", () => {
  const t = nativeTokens(DARK);
  for (const surface of [DARK.surface0, DARK.surface2, DARK.surface1, t.surfaceSidebarSelected]) {
    assert.ok(contrast(t.accentBright, surface) >= 4.5);
    assert.ok(contrast(t.foregroundSelected, surface) >= 4.5);
  }
});

test("hosts that predate the faint and status dot colours fall back to one expression/set", () => {
  const { foregroundExtraMuted: _faint, ...old } = LIGHT;
  const t = nativeTokens(old);
  assert.equal(t.foregroundExtraMuted, context.mix(old.foregroundMuted, old.surface0, 0.65));
  assert.deepEqual(
    [t.statusDotRunning, t.statusDotSuccess, t.statusDotWarning, t.statusDotDanger],
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
