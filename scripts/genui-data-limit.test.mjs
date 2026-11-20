import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import contribute from "../plugins/genui/server/genui.gen.ts";

test("GenUI loads 16 MiB of JSON and rejects a file one byte larger", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-genui-limit-"));
  const agentId = path.basename(home);
  try {
    const handlers = new Map();
    contribute({
      registerSettings: () => ({
        read: async () => ({ status: "loading" }),
        subscribe: () => () => {},
      }),
      before() {},
      on() {},
      handle: (rpc, handler) => handlers.set(rpc.name, handler),
    });
    const load = handlers.get("genui.load_data");
    const context = {
      paseo: { agents: { ref: () => ({ current: () => ({ cwd: home }) }) } },
    };
    const file = path.join(home, "report.json");
    const limit = 16 * 1024 * 1024;
    await writeFile(file, '{"passed":true}'.padEnd(limit));
    const input = { agentId, path: "report.json" };
    assert.deepEqual(await load(input, context), { ok: true, value: { passed: true } });

    await truncate(file, limit + 1);
    assert.deepEqual(await load(input, context), {
      ok: false,
      error: `${limit + 1} bytes is over the ${limit}-byte limit`,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(path.join("/tmp/opencode/genui-storage", agentId), { recursive: true, force: true });
  }
});
