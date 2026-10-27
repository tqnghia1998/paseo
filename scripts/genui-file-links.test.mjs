import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../plugins/genui/client/genui.gen.ts", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "genui.js",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
function functionSource(name) {
  const fn = parsed.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(fn, `Missing ${name}`);
  return fn.getText(parsed);
}
function runtime(web = {}, referrer = "http://localhost:8100/") {
  const posts = [];
  const routes = [];
  const win = {
    name: "paseo-workspace:bots:/workspace",
    parent: { postMessage: (...args) => posts.push(args) },
    location: { pathname: "/h/host/plugin/paseo-bots/sidebar/bots" },
    history: { pushState: (...args) => routes.push(args) },
    dispatchEvent() {},
    ...web,
  };
  const context = vm.createContext({
    getWeb: () => ({
      window: win,
      document: { referrer },
      PopStateEvent: Event,
    }),
    URL,
    btoa,
    unescape,
    encodeURIComponent,
    Number,
  });
  vm.runInContext(functionSource("openWorkspaceFile"), context);
  return { open: context.openWorkspaceFile, posts, routes };
}
test("opens the reported XPI in the embedding IDE without changing routes", () => {
  const r = runtime();
  const root =
    "/Users/quangnghia.trinh/Documents/space-app-vibing/space-session-extension-worktrees/main";
  assert.equal(r.open(`${root}/dist/space-session-1.1.5-unsigned.xpi`, undefined, root), true);
  assert.deepEqual(JSON.parse(JSON.stringify(r.posts)), [
    [
      {
        type: "paseo:open-file",
        path: "dist/space-session-1.1.5-unsigned.xpi",
        line: 1,
      },
      "http://localhost:8100",
    ],
  ]);
  assert.equal(r.routes.length, 0);
});
test("keeps relative file paths, spaces and line numbers intact", () => {
  const r = runtime();
  assert.equal(r.open("src/my file.ts", 23, "/workspace"), true);
  assert.equal(r.posts[0][0].path, "src/my file.ts");
  assert.equal(r.posts[0][0].line, 23);
});
test("does not send paths outside the worktree or invalid lines", () => {
  for (const [path, line] of [
    ["/workspace-other/a.ts", 1],
    ["/etc/passwd", 1],
    ["../secret", 1],
    ["src/../../secret", 1],
    ["C:/other/a.ts", 1],
    ["", 1],
    ["a.ts", 0],
    ["a.ts", NaN],
  ]) {
    const r = runtime();
    assert.equal(r.open(path, line, "/workspace"), false, `${path}:${line}`);
    assert.equal(r.posts.length, 0);
    assert.equal(r.routes.length, 0);
  }
});
test("standalone workspace file navigation remains available", () => {
  const win = {
    name: "",
    location: { pathname: "/h/host/workspace/worktree" },
  };
  const r = runtime(win);
  assert.equal(r.open("/workspace/a.ts"), true);
  assert.equal(r.posts.length, 0);
  assert.match(r.routes[0][2], /^\/h\/host\/workspace\/worktree\?open=/);
});
test("refuses the embedded handoff without a valid host origin or workspace root", () => {
  const r = runtime();
  assert.equal(r.open("/workspace/a.ts"), false);
  assert.equal(r.posts.length, 0);
  for (const origin of ["", "file:///tmp/host.html", "invalid"]) {
    const missing = runtime({}, origin);
    assert.equal(missing.open("a.ts", 1, "/workspace"), false);
    assert.equal(missing.posts.length, 0);
  }
});
test("timeline file actions use the owning agent cwd and preserve the line", () => {
  const opened = [];
  const context = vm.createContext({
    usePaseo: () => ({}),
    useAgent: (id, select) => {
      assert.equal(id, "agent");
      return select({ cwd: "/workspace" });
    },
    useCallback3: (fn) => fn,
    openWorkspaceFile: (...args) => opened.push(args),
    jsx13: (type, props) => ({ type, props }),
    SpecBlockView: "spec",
  });
  vm.runInContext(functionSource("TimelineBlockItem"), context);
  const block = context.TimelineBlockItem({
    agentId: "agent",
    item: { data: { language: "ui" } },
    timestamp: new Date(),
    layout: { platform: "web" },
  });
  block.props.openFile("src/a.ts", 17);
  assert.deepEqual(opened, [["src/a.ts", 17, "/workspace"]]);
});
test("File uses one press target and opens files on web", () => {
  const opened = [];
  const node = (type, props) => ({ type, props });
  const context = vm.createContext({
    useUiRuntime: () => ({
      theme: { colors: {} },
      openFile: (...args) => opened.push(args),
    }),
    text: String,
    finiteNumber: (x) => (typeof x === "number" ? x : null),
    Platform3: { OS: "web" },
    Pressable2: "button",
    View4: "div",
    RNText: "text",
    PaseoIcon: "icon",
    StyleSheet4: { hairlineWidth: 1 },
    jsx4: node,
    jsxs3: node,
    React4: {
      createElement: (type, props, children) => node(type, { ...props, children }),
    },
  });
  vm.runInContext(functionSource("File"), context);
  const file = context.File({ props: { path: "/workspace/a.ts", line: 42 } });
  assert.equal(file.type, "button");
  file.props.onPress();
  assert.deepEqual(opened, [["/workspace/a.ts", 42]]);
});
