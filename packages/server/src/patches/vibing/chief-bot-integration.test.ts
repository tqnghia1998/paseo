import { afterEach, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { settingsRpc } from "@getpaseo/plugin";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTestPaseoDaemon } from "../../server/test-utils/paseo-daemon.js";
import { createTestAgentClients } from "../../server/test-utils/fake-agent-client.js";
import { DaemonClient } from "../../server/test-utils/daemon-client.js";
import {
  BuiltinPluginLoader,
  resolveBuiltinPluginsRoot,
} from "../../server/plugins/builtin/index.js";
import { CHIEF_TOOLS } from "./chief-session.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});

test("managed Chief hands a task to an ordinary Bot chat in the feature workspace", async () => {
  const fixture = await createTestPaseoDaemon({
    worktreeCleanupToken: "fixture-host-only",
    agentClients: createTestAgentClients({ supportsMcpServers: true }),
    builtinPlugins: new BuiltinPluginLoader(resolveBuiltinPluginsRoot(), ["paseo-bots"]),
  });
  cleanup.push(() => fixture.close());
  const connection = new DaemonClient({ url: `ws://127.0.0.1:${fixture.port}/ws` });
  cleanup.push(async () => connection.close());
  await connection.connect();
  const rpc = settingsRpc("bots");
  const state = (await connection.invokePluginRpc("paseo-bots", rpc.read.name, {})) as {
    revision: string;
    values: Record<string, unknown>;
  };
  await connection.invokePluginRpc("paseo-bots", rpc.write.name, {
    revision: state.revision,
    values: {
      ...state.values,
      bots: [
        {
          id: "fixture-reviewer",
          name: "Reviewer",
          provider: "claude",
          model: "sonnet",
          avatar: { seed: "review" },
          createdAt: "2026-11-07",
          updatedAt: "2026-11-07",
        },
      ],
    },
  });
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "chief-real-manager-"));
  cleanup.push(() => fs.rm(cwd, { recursive: true, force: true }));
  const apps = [
    {
      id: "fixture-app",
      name: "Fixture",
      gitRepo: "",
      workspaces: [{ id: "main", name: "main", cwd }],
    },
  ];
  const post = async () => {
    const response = await fetch(`http://127.0.0.1:${fixture.port}/api/chief/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paseo-worktree-cleanup-token": "fixture-host-only",
      },
      body: JSON.stringify({ apps }),
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<{ agentId: string }>;
  };
  const descriptor = await post();
  expect(await post()).toEqual(descriptor);
  const chief = fixture.daemon.agentManager.getAgent(descriptor.agentId)!;
  expect(chief.labels["paseo-bots.bot"]).toBe("vibing-chief");
  const config = chief.config.mcpServers!.chief;
  if (config.type !== "http") throw new Error("Expected HTTP Chief");
  const client = new Client({ name: "managed-chief-fixture", version: "1" });
  cleanup.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    }),
  );
  expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
    [...CHIEF_TOOLS].sort(),
  );
  const call = async (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  expect(
    (await call("write_memory", { name: "MEMORY.md", text: "Fixture preference" })).isError,
  ).not.toBe(true);
  expect(JSON.stringify(await call("read_memory", { name: "MEMORY.md" }))).toContain(
    "Fixture preference",
  );
  await fixture.daemon.agentManager.runAgent(
    descriptor.agentId,
    "Ask Reviewer to add a logout   button to the header",
    { clientMessageId: randomUUID() },
  );
  const request = {
    requestId: randomUUID(),
    appId: "fixture-app",
    workspaceId: "main",
    bot: "Reviewer",
    kind: "implement",
    instruction: "add a logout button to the header",
  };
  const first = await call("start_feature_task", request);
  expect(first.isError ? JSON.stringify(first.content) : "").toBe("");
  const receipt = JSON.parse((first.content as Array<{ text: string }>)[0]!.text) as {
    chatId: string;
    status: string;
  };
  expect(receipt.chatId).toBe(request.requestId);
  expect(JSON.parse((await call("start_feature_task", request)).content[0].text).chatId).toBe(
    receipt.chatId,
  );
  const chat = fixture.daemon.agentManager.getAgent(receipt.chatId)!;
  expect(chat.cwd).toBe(cwd);
  expect(chat.background).toBe(false);
  expect(chat.config.providerOptions?.restrictToConfiguredMcp).not.toBe(true);
  expect(chat.labels).toMatchObject({
    "paseo-bots.bot": "fixture-reviewer",
    "paseo-bots.asked-by": "vibing-chief",
    "paseo-chief.bot-name": "Reviewer",
    "paseo-chief.app": "fixture-app",
    "paseo-chief.workspace": "main",
  });
  expect(chat.labels["paseo-bots.context"]).toBeUndefined();
  const poll = async () =>
    (await (
      await fetch(`http://127.0.0.1:${fixture.port}/api/chief/navigation/poll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paseo-worktree-cleanup-token": "fixture-host-only",
        },
        body: JSON.stringify({ apps }),
      })
    ).json()) as { requests: unknown[]; handoffs: Array<Record<string, unknown>> };
  await expect
    .poll(async () => (await poll()).handoffs)
    .toEqual([
      expect.objectContaining({
        chatId: receipt.chatId,
        appId: "fixture-app",
        workspaceId: "main",
        bot: "Reviewer",
        title: expect.stringContaining("Reviewer · "),
      }),
    ]);
  const status = await call("check_feature_task", { chatId: receipt.chatId });
  expect(JSON.stringify(status)).toMatch(/working|idle|needs-input|failed/);
  expect(JSON.stringify(status)).not.toContain("logout");
}, 30_000);
