import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import {
  query as sdkQuery,
  type Options,
  type Query,
  type SpawnOptions as ClaudeSpawnOptions,
  type SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, onTestFinished, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import * as spawnUtils from "../../../../utils/spawn.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryInput } from "./query.js";

function createQueryMock(events: unknown[]): Query {
  let index = 0;
  return {
    next: vi.fn(async () =>
      index < events.length
        ? { done: false, value: events[index++] }
        : { done: true, value: undefined },
    ),
    return: vi.fn(async () => ({ done: true, value: undefined })),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => [{ value: "opus", displayName: "Opus" }]),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as Query;
}

function createChildProcessStub(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stderr = new EventEmitter() as ChildProcess["stderr"];
  return child;
}

describe("Claude spawn override", () => {
  const homes: string[] = [];
  const isolateHome = () => {
    const home = mkdtempSync(join(tmpdir(), "chief-provider-"));
    homes.push(home);
    vi.stubEnv("CLAUDE_CONFIG_DIR", home);
  };
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  test("keeps isolated tools and settings on query recreation without changing another session", async () => {
    isolateHome();
    const configDir = mkdtempSync(join(tmpdir(), "claude-isolated-options-"));
    onTestFinished(() => rmSync(configDir, { recursive: true, force: true }));
    const captured: Options[] = [];
    const queryFactory = ({ options }: ClaudeQueryInput) => {
      captured.push(options);
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: "isolated-tool-session",
          permissionMode: "default",
          model: "opus",
          tools: options.allowedTools ?? [],
        },
        { type: "assistant", message: { content: [{ type: "text", text: "fixture response" }] } },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 1, output_tokens: 1 },
          total_cost_usd: 0,
        },
      ]);
    };
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
      runtimeSettings: { env: { CLAUDE_CONFIG_DIR: configDir } },
    });
    const isolated = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
      providerOptions: {
        restrictToConfiguredMcp: true,
        tools: ["Bash"],
        allowedTools: ["Bash(*)"],
        extraArgs: { "dangerously-skip-permissions": null },
      },
      mcpServers: { chief: { type: "http", url: "http://127.0.0.1:1/mcp" } },
    });
    const ordinary = await client.createSession({ provider: "claude", cwd: process.cwd() });
    try {
      await isolated.run("first turn");
      await isolated.setModel("sonnet");
      await isolated.run("second turn");
      await ordinary.run("ordinary turn");
    } finally {
      await isolated.close();
      await ordinary.close();
    }
    expect(captured).toHaveLength(3);
    for (const options of captured.slice(0, 2)) {
      expect(options.tools).toEqual([]);
      expect(options.settingSources).toEqual([]);
      expect(options.strictMcpConfig).toBe(true);
      expect(options.agents).toEqual({});
      expect(options.hooks).toEqual({});
      expect(options.allowDangerouslySkipPermissions).toBe(false);
      expect(options.allowedTools).toEqual([]);
      expect(options.extraArgs).toBeUndefined();
      expect(options.env?.CLAUDE_CODE_MODEL_CAPABILITIES).toBe(
        "-mid_conv_system,-mid_conv_tool_change,-inline_tools",
      );
      expect(options.env?.CLAUDE_CODE_INLINE_TOOLS).toBe("0");
      expect(options.env?.CLAUDE_CODE_HOST_PROMPT_SUPERSEDES_RECORD).toBe("1");
      expect(Object.keys(options.mcpServers ?? {})).toEqual(["chief"]);
    }
    expect(captured[2]?.tools).toBeUndefined();
    expect(captured[2]?.strictMcpConfig).toBeUndefined();
    expect(captured[2]?.env?.CLAUDE_CODE_MODEL_CAPABILITIES).toBeUndefined();
    expect(captured[2]?.settingSources).toEqual(["user", "project", "local"]);
  });

  test("rejects unexpected init inventory and denies ungranted permission callbacks", async () => {
    isolateHome();
    let captured: Options | undefined;
    const query = createQueryMock([
      { type: "system", subtype: "init", session_id: "untrusted-tools", tools: ["Bash"] },
      { type: "assistant", message: { content: [{ type: "text", text: "must not run" }] } },
      { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 },
    ]);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      resolveBinary: async () => "/fixture/claude",
      queryFactory: ({ options }: ClaudeQueryInput) => {
        captured = options;
        return query;
      },
    });
    const session = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
      providerOptions: { restrictToConfiguredMcp: true },
    });
    try {
      const outcome = await session.run("fixture only").then(
        (result) => result.finalText,
        (error) => String(error),
      );
      expect(outcome).toContain("Configured MCP inventory mismatch");
      expect(outcome).not.toContain("must not run");
      expect(query.close).toHaveBeenCalled();
      const denied = await captured!.canUseTool!(
        "Bash",
        {},
        {
          signal: new AbortController().signal,
          toolUseID: "fixture-tool",
        },
      );
      expect(denied.behavior).toBe("deny");
    } finally {
      await session.close();
    }
  });

  test("bypasses the shell when spawning Claude Code", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: "claude-spawn-shell-regression-session",
          permissionMode: "default",
          model: "opus",
        },
        {
          type: "assistant",
          message: { content: "done" },
        },
        {
          type: "result",
          subtype: "success",
          usage: {
            input_tokens: 1,
            cache_read_input_tokens: 0,
            output_tokens: 1,
          },
          total_cost_usd: 0,
        },
      ]);
    });
    const spawnSpy = vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(createChildProcessStub());
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    try {
      await session.run("spawn shell regression");
      capturedOptions?.spawnClaudeCodeProcess?.({
        command: "node",
        args: ["claude.js", "--mcp-config", '{"mcpServers":{"paseo":{"type":"http"}}}'],
        cwd: process.cwd(),
        env: {},
        signal: new AbortController().signal,
      } satisfies ClaudeSpawnOptions);
    } finally {
      await session.close();
    }

    const claudeSpawnCall = spawnSpy.mock.calls.find(([, args]) => args[0] === "claude.js");
    expect(claudeSpawnCall).toBeDefined();
    const spawnOptions = claudeSpawnCall?.[2];
    expect(spawnOptions?.shell).toBe(false);
  });

  test("keeps the Paseo MCP bearer token off the Claude Code command line", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock([]);
    });
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
      resolveVersion: async () => "2.1.326",
    });
    const session = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
      mcpServers: {
        paseo: {
          type: "http",
          url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
          headers: { Authorization: "Bearer secret-token" },
        },
      },
    });
    await (session as unknown as { ensureQuery(): Promise<unknown> }).ensureQuery();
    await session.close();
    if (!capturedOptions) {
      throw new Error("Claude query options were not captured");
    }

    // Feed Paseo's options to the real SDK and record the argv it would launch with.
    let launchArgs: string[] | undefined;
    let stdinText = "";
    const stdin = new PassThrough();
    stdin.on("data", (chunk: Buffer) => {
      stdinText += chunk.toString("utf8");
    });
    const abortController = new AbortController();
    const sdk = sdkQuery({
      prompt: "hello",
      options: {
        ...capturedOptions,
        abortController,
        spawnClaudeCodeProcess: (spawnOptions: ClaudeSpawnOptions): SpawnedProcess => {
          launchArgs = spawnOptions.args;
          const child = new EventEmitter() as EventEmitter & SpawnedProcess;
          Object.assign(child, {
            stdin,
            stdout: new PassThrough(),
            killed: false,
            exitCode: null,
            kill: () => true,
          });
          return child;
        },
      },
    });
    // The fake process never answers, so the first message never arrives; only the launch matters.
    void sdk.next().catch(() => undefined);
    await vi.waitFor(() => {
      expect(stdinText).toContain("secret-token");
    });
    abortController.abort();

    expect(launchArgs).toBeDefined();
    expect(launchArgs?.join(" ")).not.toContain("secret-token");
    expect(launchArgs).not.toContain("--mcp-config");
  });

  test("starts Claude Code behind the session's launch wrap", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "claude-launch-wrap-"));
    const launcher = path.join(root, "launcher.mjs");
    await writeFile(launcher, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    let capturedOptions: Options | undefined;
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory: ({ options }: ClaudeQueryInput) => {
        capturedOptions = options;
        return createQueryMock([]);
      },
      resolveBinary: async () => "/test/claude/bin",
      resolveVersion: async () => "2.1.326",
    });
    const session = await client.createSession(
      { provider: "claude", cwd: root },
      { wrap: [process.execPath, launcher, "--sandbox"] },
    );
    try {
      await (session as unknown as { ensureQuery(): Promise<unknown> }).ensureQuery();
      const child = capturedOptions?.spawnClaudeCodeProcess?.({
        command: "/test/claude/bin",
        args: ["--output-format", "stream-json"],
        cwd: root,
        env: {},
        signal: new AbortController().signal,
      }) as ChildProcess | undefined;
      if (!child?.stdout) throw new Error("Claude Code was not spawned");
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      await new Promise((resolve) => child.once("close", resolve));
      expect(JSON.parse(stdout)).toEqual([
        "--sandbox",
        "/test/claude/bin",
        "--output-format",
        "stream-json",
      ]);
    } finally {
      await session.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
