import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
import { AgentStorage } from "../../server/agent/agent-storage.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

// Source-overlay checks can exercise the native plugin compiler without regenerating bundles.
const pluginsRoot = process.env.PASEO_CHIEF_TEST_PLUGINS_ROOT ?? resolveBuiltinPluginsRoot();
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});

test.each([false, true])(
  "managed Chief hands off tasks and preserves work after failed delete: %s",
  async (failDelete) => {
    const startupEntered = Promise.withResolvers<void>();
    const startupRelease = Promise.withResolvers<void>();
    let featureCwd: string | null = null;
    const clients = createTestAgentClients({ supportsMcpServers: true });
    const claude = clients.claude!;
    const createSession = claude.createSession.bind(claude);
    claude.createSession = async (...args) => {
      const session = await createSession(...args);
      const startTurn = session.startTurn.bind(session);
      session.startTurn = async (...turnArgs) => {
        if (args[0].cwd === featureCwd) {
          startupEntered.resolve();
          await startupRelease.promise;
        }
        return startTurn(...turnArgs);
      };
      return session;
    };
    const fixture = await createTestPaseoDaemon({
      worktreeCleanupToken: "fixture-host-only",
      agentClients: clients,
      builtinPlugins: new BuiltinPluginLoader(pluginsRoot, ["paseo-bots"]),
    });
    cleanup.push(() => fixture.close());
    cleanup.push(async () => startupRelease.resolve());
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
    featureCwd = cwd;
    cleanup.push(() => fs.rm(cwd, { recursive: true, force: true }));
    execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "pipe" });
    execFileSync("git", ["remote", "add", "origin", "https://git.example.test/team/repo"], {
      cwd,
      stdio: "pipe",
    });
    const apps = [
      {
        id: "fixture-app",
        name: "Fixture",
        gitRepo: "https://git.example.test/team/repo",
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
    const starting = call("start_feature_task", request);
    await startupEntered.promise;
    try {
      const pending = fixture.daemon.agentManager.getAgent(request.requestId)!;
      expect(pending.lifecycle).toBe("idle");
      expect(fixture.daemon.agentManager.hasInFlightRun(request.requestId)).toBe(true);
      const observation = await fetch(
        `http://127.0.0.1:${fixture.port}/api/chief/navigation/poll`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-paseo-worktree-cleanup-token": "fixture-host-only",
          },
          body: JSON.stringify({ apps }),
        },
      );
      expect((await observation.json()).handoffs).toContainEqual(
        expect.objectContaining({
          chatId: request.requestId,
          status: "working",
        }),
      );
      const checked = await call("check_feature_task", { chatId: request.requestId });
      expect(JSON.parse(checked.content[0].text)).toMatchObject({ status: "working" });
    } finally {
      startupRelease.resolve();
      await starting;
    }
    const first = await starting;
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
    if (failDelete) {
      await expect
        .poll(() => fixture.daemon.agentManager.hasInFlightRun(receipt.chatId))
        .toBe(false);
      const files = await fs.readdir(fixture.config.agentStoragePath, { recursive: true });
      const relative = files.find((file) => file.endsWith(`${receipt.chatId}.json`));
      if (!relative) throw new Error("Bot record missing before deletion");
      const target = path.join(fixture.config.agentStoragePath, relative);
      const originalUnlink = fs.unlink.bind(fs);
      const unlink = vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
        if (String(file) === target)
          throw Object.assign(new Error("fixture unlink denied"), { code: "EACCES" });
        return originalUnlink(file);
      });
      const chatPost = async (operation: string, body: unknown) => {
        const response = await fetch(
          `http://127.0.0.1:${fixture.port}/api/chief/chats/${operation}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-paseo-worktree-cleanup-token": "fixture-host-only",
            },
            body: JSON.stringify(body),
          },
        );
        expect(response.status).toBe(200);
        return response.json();
      };
      try {
        expect(await chatPost("delete", { chatIds: [receipt.chatId] })).toMatchObject({
          deleted: [],
          skipped: [{ id: receipt.chatId, reason: "deleting failed" }],
        });
      } finally {
        unlink.mockRestore();
      }
      const completed = Promise.withResolvers<void>();
      const unsubscribe = fixture.daemon.agentManager.subscribe(
        (event) => {
          if (event.type === "agent_stream" && event.event.type === "turn_completed")
            completed.resolve();
        },
        { agentId: receipt.chatId, replayState: false },
      );
      cleanup.push(async () => unsubscribe());
      expect(
        await chatPost("send", {
          chatId: receipt.chatId,
          text: 'Remember marker "AFTER_FAILED_DELETE"',
        }),
      ).toEqual({ ok: true });
      await completed.promise;
      await fixture.daemon.agentManager.setAgentModel(receipt.chatId, "opus");
      await fixture.daemon.agentManager.flush();
      await fixture.daemon.agentManager.closeAgent(receipt.chatId);
      const cold = new AgentStorage(fixture.config.agentStoragePath, createTestLogger());
      expect(await cold.get(receipt.chatId)).toMatchObject({
        config: { model: "opus" },
        persistence: { metadata: { marker: "AFTER_FAILED_DELETE" } },
      });
      expect(await chatPost("delete", { chatIds: [receipt.chatId] })).toEqual({
        deleted: [receipt.chatId],
        skipped: [],
      });
    }
  },
  30_000,
);

test.each(["none", "close", "unlink"] as const)(
  "Chief Bot tools survive /clear and retry retirement after failure: %s",
  async (failure) => {
    const closeFails = failure === "close";
    let rejectClose = false;
    const turnEntered = Promise.withResolvers<void>();
    const turnRelease = Promise.withResolvers<void>();
    let running: Promise<unknown> | undefined;
    const fixture = await createTestPaseoDaemon({
      worktreeCleanupToken: "fixture-host-only",
      agentClients: createTestAgentClients({
        supportsMcpServers: true,
        closeSession: async () => {
          if (rejectClose) throw new Error("fixture provider close failed");
        },
        beforeTurnComplete: async () => {
          turnEntered.resolve();
          await turnRelease.promise;
        },
      }),
      builtinPlugins: new BuiltinPluginLoader(pluginsRoot, ["paseo-bots"]),
    });
    cleanup.push(() => fixture.close());
    cleanup.push(async () => {
      rejectClose = false;
      turnRelease.resolve();
      await running;
    });
    const headers = {
      "Content-Type": "application/json",
      "x-paseo-worktree-cleanup-token": "fixture-host-only",
    };
    const post = async (operation: "connect" | "restart") => {
      const response = await fetch(`http://127.0.0.1:${fixture.port}/api/chief/${operation}`, {
        method: "POST",
        headers,
        body: JSON.stringify(operation === "connect" ? { apps: [] } : {}),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{ agentId: string }>;
    };
    const connectTools = async (agentId: string) => {
      const agent = fixture.daemon.agentManager.getAgent(agentId)!;
      const config = agent.config.mcpServers!.chief;
      if (config.type !== "http") throw new Error("Expected HTTP Chief");
      const client = new Client({ name: "chief-restart-fixture", version: "1" });
      cleanup.push(() => client.close());
      await client.connect(
        new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers },
        }),
      );
      return client;
    };
    const first = await post("connect");
    const firstTools = await connectTools(first.agentId);
    const written = await firstTools.callTool({
      name: "write_memory",
      arguments: { name: "MEMORY.md", text: "Keep this preference after clear" },
    });
    expect(written.isError).not.toBe(true);

    const oldAgent = fixture.daemon.agentManager.getAgent(first.agentId)!;
    if (closeFails) {
      running = fixture.daemon.agentManager.runAgent(
        first.agentId,
        "Fixture work to retain on failed close",
      );
      await turnEntered.promise;
      rejectClose = true;
    }
    let recordPath: string | undefined;
    let restoreUnlink: (() => void) | undefined;
    if (failure === "unlink") {
      const storagePath = fixture.config.agentStoragePath;
      const files = await fs.readdir(storagePath, { recursive: true });
      const relative = files.find((file) => file.endsWith(`${first.agentId}.json`));
      if (!relative) throw new Error("Chief record file missing before deletion");
      recordPath = path.join(storagePath, relative);
      const originalUnlink = fs.unlink.bind(fs);
      const unlink = vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
        if (String(file) === recordPath)
          throw Object.assign(new Error("fixture unlink denied"), { code: "EACCES" });
        return originalUnlink(file);
      });
      restoreUnlink = () => unlink.mockRestore();
      cleanup.push(async () => restoreUnlink?.());
    }
    const replacement = await post("restart");
    expect(replacement.agentId).not.toBe(first.agentId);
    if (closeFails) {
      const retained = fixture.daemon.agentManager.getAgent(first.agentId);
      expect(retained?.session).toBe(oldAgent.session);
      expect(retained?.lifecycle).toBe("running");
      expect(await fixture.daemon.agentStorage.get(first.agentId)).not.toBeNull();
      expect(
        (await fixture.daemon.agentManager.getTimelineRows(first.agentId)).length,
      ).toBeGreaterThan(0);
      const stored = JSON.parse(
        await fs.readFile(path.join(fixture.paseoHome, "chief", "session.json"), "utf8"),
      );
      expect(stored.retired).toContain(first.agentId);
      // Failed closure must not tombstone future persistence for the still-live agent.
      await fixture.daemon.agentManager.updateAgentMetadata(first.agentId, {
        title: "Retained after failed cleanup",
      });
      await fixture.daemon.agentManager.flush();
      expect((await fixture.daemon.agentStorage.get(first.agentId))?.title).toBe(
        "Retained after failed cleanup",
      );
      rejectClose = false;
      turnRelease.resolve();
      await running;
      expect(await post("connect")).toEqual(replacement);
      expect(await fixture.daemon.agentStorage.get(first.agentId)).toBeNull();
      expect(
        JSON.parse(await fs.readFile(path.join(fixture.paseoHome, "chief", "session.json"), "utf8"))
          .retired,
      ).not.toContain(first.agentId);
    }
    if (failure === "unlink") {
      expect(fixture.daemon.agentManager.getAgent(first.agentId)).toBeNull();
      expect(await fixture.daemon.agentStorage.get(first.agentId)).not.toBeNull();
      const privateState = path.join(fixture.paseoHome, "chief", "session.json");
      expect(JSON.parse(await fs.readFile(privateState, "utf8")).retired).toContain(first.agentId);
      expect(JSON.parse(await fs.readFile(recordPath!, "utf8")).id).toBe(first.agentId);
      const cold = new AgentStorage(fixture.config.agentStoragePath, createTestLogger());
      expect(await cold.get(first.agentId)).not.toBeNull();
      restoreUnlink!();
      expect(await post("connect")).toEqual(replacement);
      expect(await fixture.daemon.agentStorage.get(first.agentId)).toBeNull();
      expect(JSON.parse(await fs.readFile(privateState, "utf8")).retired).not.toContain(
        first.agentId,
      );
      await expect(fs.stat(recordPath!)).rejects.toMatchObject({ code: "ENOENT" });
      const afterRetry = new AgentStorage(fixture.config.agentStoragePath, createTestLogger());
      expect(await afterRetry.get(first.agentId)).toBeNull();
    }
    await expect(
      fixture.daemon.agentManager.runAgent(first.agentId, "Do not run this retired Chief", {
        clientMessageId: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(fixture.daemon.agentManager.getAgent(first.agentId)).toBeNull();

    const replacementTools = await connectTools(replacement.agentId);
    const read = await replacementTools.callTool({
      name: "read_memory",
      arguments: { name: "MEMORY.md" },
    });
    expect(read.isError ? JSON.stringify(read.content) : "").toBe("");
    expect(read.content).toEqual([{ type: "text", text: "Keep this preference after clear" }]);
  },
  30_000,
);
