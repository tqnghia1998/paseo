import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityProvider } from "./provider.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function launchAgent(source: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-antigravity-acp-"));
  directories.push(directory);
  const executable = path.join(directory, "agy.cjs");
  await writeFile(executable, source);
  return {
    directory,
    launch: {
      command: process.execPath,
      args: [executable, "acp", "--disable-telemetry"],
      env: { CAPTURE: path.join(directory, "requests.ndjson") },
    },
  };
}

it("reports a CLI without the acp subcommand as unavailable", async () => {
  const { launch } = await launchAgent(`
    process.stderr.write("Unknown command: acp");
    process.exitCode = 1;
  `);
  const provider = createAntigravityProvider();
  expect(provider.command?.slice(0, 2)).toEqual(["agy", "acp"]);
  expect(await provider.status!({ launch })).toMatchObject({
    available: false,
    diagnostic: expect.stringContaining("1.5.0"),
  });
});

const minimalAcpAgent = `
  const { createInterface } = require("node:readline");
  createInterface({ input: process.stdin }).on("line", (line) => {
    const { id, method } = JSON.parse(line);
    if (method === "initialize")
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: 1, agentCapabilities: {} } }) + "\\n");
  });
`;

describe("diagnostic", () => {
  it("says agy runs outside an SSH session when the daemon has no SSH variables", async () => {
    const { launch } = await launchAgent(minimalAcpAgent);
    expect(await createAntigravityProvider().status!({ launch })).toEqual({
      available: true,
      diagnostic: "SSH session: no\nSign-in: can differ from agy over SSH",
    });
  });

  it.each(["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"])(
    "says agy runs in an SSH session when the daemon has %s",
    async (variable) => {
      const { launch } = await launchAgent(minimalAcpAgent);
      const env = { ...launch.env, [variable]: "set" };
      expect(await createAntigravityProvider().status!({ launch: { ...launch, env } })).toEqual({
        available: true,
        diagnostic: `SSH session: yes (${variable})\nSign-in: can differ from agy outside SSH`,
      });
    },
  );

  it("says whether agy runs in an SSH session when ACP does not start", async () => {
    const { launch } = await launchAgent(`process.exit(1);`);
    const env = { ...launch.env, SSH_CONNECTION: "set" };
    expect(await createAntigravityProvider().status!({ launch: { ...launch, env } })).toEqual({
      available: false,
      diagnostic: [
        "Antigravity ACP did not start. Install Antigravity 1.5.0 or later. If you override the command, include the acp subcommand.",
        "SSH session: yes (SSH_CONNECTION)",
        "Sign-in: can differ from agy outside SSH",
      ].join("\n"),
    });
  });
});

it("publishes Antigravity skills separately from built-in commands", async () => {
  const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method } = JSON.parse(line);
      if (method === "initialize") {
        send({ id, result: { protocolVersion: 1 } });
      }
      if (method === "session/new") {
        send({ id, result: { sessionId: "native", modes: {
          currentModeId: "default", availableModes: [{ id: "default", name: "Default" }],
        } } });
        send({ method: "session/update", params: { sessionId: "native", update: {
          sessionUpdate: "available_commands_update",
          availableCommands: ["goal", "compact", "schedule", "browser", "plan", "grill-me",
            "teamwork", "learn", "boost", "agy-customizations", "antigravity-guide", "diagnose"]
            .map(name => ({ name, description: name })),
        } } });
      }
    });
  `);
  const connection = await createAntigravityProvider().connect({
    launch,
    versions: [1],
    capabilities: [],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({
      type: "session.open",
      requestId: "new",
      sessionId: "test",
      history: "skip",
      config: { cwd: directory, env: {}, mcpServers: {}, settings: {}, persist: false },
    });
    await expect
      .poll(() =>
        events.find(
          (event) => event.type === "session.commands" || event.type === "request.failed",
        ),
      )
      .toMatchObject({ type: "session.commands" });
    await expect
      .poll(() => events.find((event) => event.type === "session.commands")?.commands)
      .toEqual([
        ...[
          "goal",
          "compact",
          "schedule",
          "browser",
          "plan",
          "grill-me",
          "teamwork",
          "learn",
          "boost",
        ].map((name) => ({ name, description: name, kind: "command" })),
        ...["agy-customizations", "antigravity-guide", "diagnose"].map((name) => ({
          name,
          description: name,
          kind: "skill",
        })),
      ]);
  } finally {
    await connection.close();
  }
});

it.each([true, false])(
  "loads a saved stream-JSON session with ACP system prompt support %s",
  async (supportsSystemPrompt) => {
    const { directory, launch } = await launchAgent(`
      const { appendFileSync } = require("node:fs");
      const { createInterface } = require("node:readline");
      const configOptions = [
        { id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-neon",
          options: [{ value: "gemini-4-neon", name: "Gemini 4 Neon" }, { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }, { value: "gemini-4-neon-high", name: "Gemini 4 Neon High" }] },
        { id: "thought_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "low",
          options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
        { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "accept-edits",
          options: [{ value: "default", name: "Default" }, { value: "accept-edits", name: "Accept edits" }] },
      ];
      const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
      createInterface({ input: process.stdin }).on("line", (line) => {
        appendFileSync(process.env.CAPTURE, line + "\\n");
        const { id, method, params } = JSON.parse(line);
        switch (method) {
          case "initialize":
            send({ id, result: { protocolVersion: 1, agentCapabilities: {
              loadSession: true,
              _meta: { antigravity: { systemPrompt: { append: ${supportsSystemPrompt} } } },
            } } });
            break;
          case "session/load":
            send({ method: "session/update", params: { sessionId: params.sessionId, update: {
              sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Saved reply" },
            } } });
            send({ method: "session/update", params: { sessionId: params.sessionId, update: {
              sessionUpdate: "tool_call", toolCallId: "write", name: "write_file", title: "File notes.txt",
              status: "completed", kind: "edit", rawInput: { Path: "/repo/notes.txt", Content: "hello" },
            } } });
            send({ id, result: { configOptions } });
            break;
          case "session/set_config_option":
            configOptions.find(option => option.id === params.configId).currentValue = params.value;
            send({ id, result: { configOptions } });
            break;
          case "session/close":
            send({ id, result: {} });
            break;
        }
      });
    `);
    const provider = createAntigravityProvider();
    expect(await provider.status!({ launch })).toMatchObject({ available: true });
    const connection = await provider.connect({
      launch,
      versions: [1],
      capabilities: ["session.configure", "session.persistence"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send({
        type: "session.open",
        requestId: "restore",
        sessionId: "test",
        history: "replay",
        persistence: { version: 1, data: { conversationId: "saved-conversation" } },
        config: {
          cwd: directory,
          model: "gemini-3.8-flash-high",
          mode: "full-access",
          systemPrompt: "A test system instruction",
          env: {},
          mcpServers: {},
          settings: {},
          persist: true,
        },
      });
      await expect
        .poll(
          () =>
            events.find(
              (event) => event.type === "session.ready" || event.type === "request.failed",
            ),
          { timeout: 3_000 },
        )
        .toMatchObject({ type: "session.ready" });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session.opened",
          persistence: { version: 1, data: { sessionId: "saved-conversation" } },
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "timeline.item",
          item: expect.objectContaining({ type: "assistant_message", text: "Saved reply" }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session.config",
          config: expect.objectContaining({
            mode: "full-access",
            modes: expect.arrayContaining([
              expect.objectContaining({ id: "full-access", isUnattended: true }),
            ]),
            model: "gemini-3.8-flash",
            thinkingOption: "high",
          }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "timeline.item",
          item: expect.objectContaining({
            type: "tool_call",
            detail: { type: "write", filePath: "/repo/notes.txt", content: "hello" },
          }),
        }),
      );
      await connection.send({
        type: "session.configure",
        requestId: "native-model",
        sessionId: "test",
        changes: { model: "gemini-4-neon-high" },
      });
      await expect
        .poll(() =>
          events.find(
            (event) =>
              event.type === "session.config" && event.config.model === "gemini-4-neon-high",
          ),
        )
        .toBeDefined();
      const requests = (await readFile(launch.env.CAPTURE, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const load = requests.find((request) => request.method === "session/load");
      expect(load.params.sessionId).toBe("saved-conversation");
      expect(load.params._meta.antigravity).toEqual(
        supportsSystemPrompt
          ? { systemPrompt: { append: "A test system instruction" } }
          : undefined,
      );
    } finally {
      await connection.close();
    }
  },
);

const completedToolCalls = [
  {
    toolCallId: "shell",
    name: "run_command",
    kind: "execute",
    rawInput: {
      CommandLine: "printf test; exit 7",
      WaitMsBeforeAsync: 5000,
      toolSummary: "Run exit code test",
    },
    rawOutput: { output: "Command exited with code 7.\n\nCommand output:\ntest", exit_code: 7 },
  },
  {
    toolCallId: "read",
    name: "read_file",
    kind: "read",
    locations: [{ path: "/repo/probe.txt" }],
    rawInput: { Path: "/repo/probe.txt", StartLine: 2, EndLine: 2 },
  },
  {
    toolCallId: "write",
    name: "write_file",
    kind: "edit",
    locations: [{ path: "/repo/probe.txt" }],
    rawInput: { Path: "/repo/probe.txt", Content: "alpha\nbeta\ngamma\n", Overwrite: true },
    rawOutput: {},
    content: [{ type: "diff", path: "/repo/probe.txt", newText: "alpha\nbeta\ngamma\n" }],
  },
  {
    toolCallId: "edit",
    name: "edit_file",
    kind: "edit",
    locations: [{ path: "/repo/probe.txt" }],
    rawInput: { Path: "/repo/probe.txt", Target: "beta", Replacement: "delta" },
    rawOutput: {},
    content: [
      {
        type: "diff",
        path: "/repo/probe.txt",
        oldText: "alpha\nbeta\ngamma\n",
        newText: "alpha\ndelta\ngamma\n",
      },
    ],
  },
  {
    toolCallId: "web",
    name: "search_web",
    kind: "search",
    rawInput: { query: "IANA example domains" },
  },
  {
    toolCallId: "paseo",
    name: "mcp_paseo_send_agent_prompt",
    kind: "other",
    rawInput: { agentId: "agent-1", prompt: "Hello", toolSummary: "Send message" },
  },
  {
    toolCallId: "mcp",
    name: "mcp_local_tools_echo_message",
    kind: "other",
    rawInput: { message: "hello", toolSummary: "Echo message hello" },
  },
  {
    toolCallId: "ambiguous",
    name: "mcp_paseo_get_agent_status",
    kind: "other",
    rawInput: { agentId: "agent-1", toolSummary: "Get agent status" },
  },
];

it.each(["live", "replay"] as const)(
  "maps Antigravity tool calls in %s timelines",
  async (source) => {
    const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    const tools = ${JSON.stringify(completedToolCalls)};
    const modes = { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] };
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      const update = (update) => send({ method: "session/update", params: { sessionId: params.sessionId ?? "agy-session", update } });
      switch (method) {
        case "initialize":
          send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
          break;
        case "session/new":
          send({ id, result: { sessionId: "agy-session", modes } });
          update({ sessionUpdate: "available_commands_update", availableCommands: [] });
          break;
        case "session/load":
        case "session/prompt":
          for (const { rawOutput, content, ...tool } of tools) {
            const completed = { status: "completed", rawOutput, content };
            if (method === "session/load") {
              update({ sessionUpdate: "tool_call", title: tool.name, ...tool, ...completed });
            } else {
              update({ sessionUpdate: "tool_call", title: tool.name, ...tool, status: "in_progress" });
              update({ sessionUpdate: "tool_call_update", toolCallId: tool.toolCallId, ...completed });
            }
          }
          send({ id, result: method === "session/load" ? { modes } : { stopReason: "end_turn" } });
          break;
        case "session/close":
          send({ id, result: {} });
          break;
      }
    });
  `);
    const connection = await createAntigravityProvider().connect({
      launch,
      versions: [1],
      capabilities: ["session.persistence", "prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send({
        type: "session.open",
        requestId: "open",
        sessionId: "test",
        history: source === "replay" ? "replay" : "skip",
        persistence:
          source === "replay" ? { version: 1, data: { sessionId: "agy-session" } } : undefined,
        config: {
          cwd: directory,
          env: {},
          mcpServers: {
            paseo_get: { type: "stdio", command: "other-server" },
            local_tools: { type: "stdio", command: "echo-mcp" },
          },
          settings: {},
          persist: true,
        },
      });
      await expect
        .poll(
          () =>
            events.find(
              (event) => event.type === "session.ready" || event.type === "request.failed",
            ),
          { timeout: 4_000 },
        )
        .toMatchObject({ type: "session.ready" });
      if (source === "live") {
        await connection.send({
          type: "session.prompt",
          sessionId: "test",
          prompt: {
            clientMessageId: "exercise-tools",
            delivery: "auto",
            input: { type: "message", content: [{ type: "text", text: "Exercise tools" }] },
          },
        });
      }
      const calls = () =>
        events.flatMap((event) =>
          event.type === "timeline.item" && event.item.type === "tool_call" ? [event.item] : [],
        );
      await expect
        .poll(() => calls().filter((call) => call.status === "completed").length)
        .toBe(completedToolCalls.length);
      const completed = Object.fromEntries(calls().map((call) => [call.id, call]));
      expect(completed.shell.detail).toEqual({
        type: "shell",
        command: "printf test; exit 7",
        output: "Command exited with code 7.\n\nCommand output:\ntest",
        exitCode: 7,
      });
      expect(completed.read.detail).toEqual({
        type: "read",
        filePath: "/repo/probe.txt",
        offset: 2,
        limit: 1,
      });
      expect(completed.write.detail).toEqual({
        type: "write",
        filePath: "/repo/probe.txt",
        content: "alpha\nbeta\ngamma\n",
      });
      expect(completed.edit.detail).toEqual({
        type: "edit",
        filePath: "/repo/probe.txt",
        oldString: "alpha\nbeta\ngamma\n",
        newString: "alpha\ndelta\ngamma\n",
      });
      expect(completed.web.detail).toEqual({
        type: "search",
        toolName: "web_search",
        query: "IANA example domains",
      });
      expect(completed.paseo).toMatchObject({
        name: "paseo.send_agent_prompt",
        detail: { type: "unknown", input: { agentId: "agent-1", prompt: "Hello" }, output: null },
      });
      expect(completed.paseo.detail).not.toHaveProperty("input.toolSummary");
      expect(completed.mcp).toMatchObject({
        name: "local_tools.echo_message",
        detail: { type: "unknown", input: { message: "hello" }, output: null },
      });
      expect(completed.mcp.detail).not.toHaveProperty("input.toolSummary");
      expect(completed.ambiguous).toMatchObject({
        name: "mcp_paseo_get_agent_status",
        detail: { type: "unknown", input: { agentId: "agent-1" }, output: null },
      });
      if (source === "live") {
        expect(calls()).toContainEqual(
          expect.objectContaining({
            id: "shell",
            status: "running",
            detail: { type: "shell", command: "printf test; exit 7" },
          }),
        );
      }
    } finally {
      await connection.close();
    }
  },
);

// agy 1.5.14 lists `thought_level` only for the selected model and omits it for Orchestrator.
it("offers each model its own thinking options and opens Orchestrator with its default", async () => {
  const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const levels = (...values) => values.map((value) => ({ value, name: value }));
    const thinking = {
      "gemini-4-neon": { currentValue: "high", options: levels("low", "medium", "high", "xhigh") },
      "gemini-4-carbon": { currentValue: "high", options: levels("low", "medium", "high") },
      "claude-opus-5-5": { currentValue: "medium", options: levels("low", "medium", "high") },
    };
    let model = "gemini-4-neon";
    const configOptions = () => [
      { id: "model", name: "Model", category: "model", type: "select", currentValue: model, options: [
        { value: "gemini-4-neon", name: "Gemini 4 Neon" },
        { value: "gemini-4-carbon", name: "Gemini 4 Carbon" },
        { value: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" },
        { value: "claude-opus-5-5", name: "Claude Opus 5.5" },
      ] },
      ...(thinking[model] ? [{ id: "thought_level", name: "Thinking", category: "thought_level", type: "select", ...thinking[model] }] : []),
      { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default",
        options: [{ value: "default", name: "Default" }, { value: "plan", name: "Plan" }] },
    ];
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      if (method === "initialize") send({ id, result: { protocolVersion: 1, agentCapabilities: {} } });
      if (method === "session/new") {
        model = "gemini-4-neon";
        send({ id, result: { sessionId: "native", configOptions: configOptions() } });
      }
      if (method === "session/set_config_option") {
        if (params.configId === "thought_level" && !thinking[model]) {
          send({ id, error: { code: -32602, message: "unknown config option" } });
          return;
        }
        if (params.configId === "model") model = params.value;
        else if (params.configId === "thought_level") thinking[model].currentValue = params.value;
        send({ id, result: { configOptions: configOptions() } });
      }
      if (method === "session/close") send({ id, result: {} });
    });
  `);
  const connection = await createAntigravityProvider().connect({
    launch,
    versions: [1],
    capabilities: ["session.configure"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({ type: "catalog", requestId: "catalog", cwd: directory });
    await expect
      .poll(() =>
        events.find((event) => event.type === "catalog" || event.type === "request.failed"),
      )
      .toMatchObject({ type: "catalog" });
    const catalog = events.find((event) => event.type === "catalog");
    if (catalog?.type !== "catalog") throw new Error("Expected a catalog");
    const thinkingByModel = Object.fromEntries(
      catalog.catalog.models.map((model) => [
        model.id,
        {
          options: model.thinkingOptions?.map((option) => option.id),
          default: model.defaultThinkingOptionId,
        },
      ]),
    );
    expect(thinkingByModel).toEqual({
      "gemini-4-neon": { options: ["low", "medium", "high", "xhigh"], default: "high" },
      "gemini-4-carbon": { options: ["low", "medium", "high"], default: "high" },
      "gemini-pro-orchestrator-neon": { options: [], default: undefined },
      "claude-opus-5-5": { options: ["low", "medium", "high"], default: "medium" },
    });

    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "orchestrator",
      history: "skip",
      config: {
        cwd: directory,
        model: "gemini-pro-orchestrator-neon",
        mode: "full-access",
        thinkingOption: thinkingByModel["gemini-pro-orchestrator-neon"]!.default,
        env: {},
        mcpServers: {},
        settings: {},
        persist: true,
      },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) =>
              (event.type === "session.ready" && event.sessionId === "orchestrator") ||
              (event.type === "request.failed" && event.requestId === "open"),
          ),
        { timeout: 3_000 },
      )
      .toMatchObject({ type: "session.ready" });
  } finally {
    await connection.close();
  }
});

describe("installation", () => {
  const signal = new AbortController().signal;

  it("reports the version agy prints and links its install docs", async () => {
    // A real `agy acp --version` starts the ACP server, so the fake refuses it.
    const { launch } = await launchAgent(`
      const args = process.argv.slice(2);
      if (args.includes("acp")) process.exit(1);
      if (args[0] === "--version") console.log("Antigravity CLI 1.6.2");
    `);
    const installation = createAntigravityProvider().installation!;
    expect(installation.installUrl).toBe("https://antigravity.google/docs/getting-started?tab=cli");
    expect(installation.update).toBeUndefined();
    await expect(
      installation.inspect!({ launch: { ...launch, resolved: true }, signal }),
    ).resolves.toEqual({
      status: "installed",
      version: "1.6.2",
    });
  });

  it("is not installed when the executable does not resolve", async () => {
    const launch = { command: "agy", args: ["acp"], env: {}, resolved: false };
    await expect(
      createAntigravityProvider().installation!.inspect!({ launch, signal }),
    ).resolves.toEqual({ status: "not_installed" });
  });
});

it("completes the turn when a recurring schedule stays in progress after end_turn", async () => {
  const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method } = JSON.parse(line);
      const update = (update) => send({ method: "session/update", params: { sessionId: "agy-session", update } });
      switch (method) {
        case "initialize":
          send({ id, result: { protocolVersion: 1 } });
          break;
        case "session/new":
          send({ id, result: { sessionId: "agy-session", modes: {
            currentModeId: "default", availableModes: [{ id: "default", name: "Default" }],
          } } });
          update({ sessionUpdate: "available_commands_update", availableCommands: [] });
          break;
        case "session/prompt": {
          const args = { CronExpression: "*/15 * * * *", Prompt: "ping" };
          update({ sessionUpdate: "usage_update", used: 12725, size: 1048576 });
          update({
            sessionUpdate: "tool_call", toolCallId: "cron", name: "schedule",
            args, status: "in_progress", kind: "other", title: "Run schedule", rawInput: args,
          });
          update({ sessionUpdate: "usage_update", used: 12915, size: 1048576 });
          send({ id, result: { stopReason: "end_turn" } });
          break;
        }
        case "session/close":
          send({ id, result: {} });
          break;
      }
    });
  `);
  const connection = await createAntigravityProvider().connect({
    launch,
    versions: [1],
    capabilities: ["prompt.message"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "test",
      history: "skip",
      config: { cwd: directory, env: {}, mcpServers: {}, settings: {}, persist: false },
    });
    await expect
      .poll(() => events)
      .toContainEqual(expect.objectContaining({ type: "session.ready", sessionId: "test" }));
    await connection.send({
      type: "session.prompt",
      sessionId: "test",
      prompt: {
        clientMessageId: "schedule-turn",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "Schedule a recurring ping" }] },
      },
    });
    await expect
      .poll(() => events)
      .toContainEqual(
        expect.objectContaining({
          type: "timeline.item",
          item: expect.objectContaining({ type: "tool_call", id: "cron", status: "running" }),
        }),
      );
    await expect
      .poll(() => events)
      .toContainEqual({
        type: "session.turn",
        sessionId: "test",
        turnId: "acp:schedule-turn",
        state: "completed",
      });
  } finally {
    await connection.close();
  }
});

it("keeps a turn open for backgrounded run_command calls but not IsDaemon commands", async () => {
  const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    let turn = 0;
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      switch (method) {
        case "initialize":
          send({ id, result: { protocolVersion: 1, agentCapabilities: {} } });
          break;
        case "session/new":
          send({ id, result: { sessionId: "agy-session", configOptions: [
            { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default",
              options: [{ value: "default", name: "Default" }] },
          ] } });
          break;
        case "session/prompt":
          turn += 1;
          if (turn === 1) {
            send({ method: "session/update", params: { sessionId: params.sessionId, update: {
              sessionUpdate: "tool_call", toolCallId: "daemon-1", name: "run_command",
              title: "Dev server", status: "in_progress", rawInput: { CommandLine: "npm run dev", IsDaemon: true },
            } } });
            send({ id, result: { stopReason: "end_turn" } });
          } else {
            send({ method: "session/update", params: { sessionId: params.sessionId, update: {
              sessionUpdate: "tool_call", toolCallId: "bg-1", name: "run_command",
              title: "Background build", status: "in_progress", rawInput: { CommandLine: "sleep 1" },
            } } });
            send({ id, result: { stopReason: "end_turn" } });
            setTimeout(() => {
              send({ method: "session/update", params: { sessionId: params.sessionId, update: {
                sessionUpdate: "tool_call_update", toolCallId: "bg-1", status: "completed",
              } } });
              send({ method: "session/update", params: { sessionId: params.sessionId, update: {
                sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Build finished." },
              } } });
              send({ method: "session/update", params: { sessionId: params.sessionId, update: {
                sessionUpdate: "usage_update", used: 50, size: 1000,
              } } });
            }, 80);
          }
          break;
        case "session/close":
          send({ id, result: {} });
          break;
      }
    });
  `);
  const provider = createAntigravityProvider();
  const connection = await provider.connect({
    launch,
    versions: [1],
    capabilities: ["prompt.message"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({
      type: "session.open",
      requestId: "open-1",
      sessionId: "agy-test",
      history: "skip",
      config: {
        cwd: directory,
        env: {},
        mcpServers: {},
        settings: {},
        persist: false,
      },
    });
    await expect
      .poll(() => events.find((event) => event.type === "session.ready"), { timeout: 3_000 })
      .toBeDefined();

    // Turn 1: IsDaemon: true completes immediately on end_turn.
    await connection.send({
      type: "session.prompt",
      sessionId: "agy-test",
      prompt: {
        clientMessageId: "daemon-turn",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "start dev server" }] },
      },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) =>
              event.type === "session.turn" &&
              event.turnId === "acp:daemon-turn" &&
              event.state === "completed",
          ),
        { timeout: 3_000 },
      )
      .toBeDefined();

    // Turn 2: non-daemon background command keeps turn open until completion + reply + usage_update.
    await connection.send({
      type: "session.prompt",
      sessionId: "agy-test",
      prompt: {
        clientMessageId: "bg-turn",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "run build" }] },
      },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) =>
              event.type === "timeline.item" &&
              event.item.type === "tool_call" &&
              event.item.id === "bg-1" &&
              event.item.status === "running",
          ),
        { timeout: 3_000 },
      )
      .toBeDefined();
    expect(
      events.some(
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:bg-turn" &&
          event.state === "completed",
      ),
    ).toBe(false);
    await expect
      .poll(
        () =>
          events.find(
            (event) =>
              event.type === "session.turn" &&
              event.turnId === "acp:bg-turn" &&
              event.state === "completed",
          ),
        { timeout: 3_000 },
      )
      .toBeDefined();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({ type: "assistant_message", text: "Build finished." }),
      }),
    );
  } finally {
    await connection.close();
  }
});

it("runs a wrapped session as [...wrap, agy, acp, --disable-telemetry] with the session env", async () => {
  const { directory, launch: fixture } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method } = JSON.parse(line);
      if (method === "initialize") send({ id, result: { protocolVersion: 1 } });
      if (method === "session/new") {
        send({ id, result: { sessionId: "native", configOptions: [{ id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] }] } });
        send({ method: "session/update", params: { sessionId: "native", update: { sessionUpdate: "available_commands_update", availableCommands: [] } } });
      }
    });
  `);
  // Records what it was started with, then runs the rest: the provider's own launch.
  const launcher = path.join(directory, "launcher.cjs");
  const record = path.join(directory, "launch.json");
  await writeFile(
    launcher,
    `const { writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const [log, command, ...args] = process.argv.slice(2);
writeFileSync(log, JSON.stringify({ argv: process.argv.slice(2), hook: process.env.HOOK_ENV ?? null }));
const child = spawn(command, args, { stdio: "inherit" });
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 1));
`,
  );
  const provider = createAntigravityProvider();
  expect(provider.launchWrap).toBe(true);
  // The daemon resolves the registration's executable and passes its arguments as declared;
  // Node running the fake agent stands in for the resolved `agy`.
  const [executable, ...declaredArgs] = provider.command!;
  expect(executable).toBe("agy");
  const agentScript = fixture.args[0]!;
  const launch = { ...fixture, args: [agentScript, ...declaredArgs] };
  const connection = await provider.connect({
    launch,
    versions: [1],
    capabilities: ["prompt.message", "session.launch_wrap"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({
      type: "session.open",
      requestId: "new",
      sessionId: "test",
      history: "skip",
      config: {
        cwd: directory,
        env: { HOOK_ENV: "final" },
        mcpServers: {},
        settings: {},
        persist: false,
        wrap: [process.execPath, launcher, record],
      },
    });
    await expect
      .poll(() =>
        events.find((event) => event.type === "session.ready" || event.type === "request.failed"),
      )
      .toMatchObject({ type: "session.ready" });
    const launched = JSON.parse(await readFile(record, "utf8"));
    expect(launched).toEqual({
      argv: [record, process.execPath, agentScript, "acp", "--disable-telemetry"],
      hook: "final",
    });
  } finally {
    await connection.close();
  }
});

it("isolates restricted tool-free sessions with an allowlisted argv, hardened agent.md, default mode, and fail-closed guards", async () => {
  const { directory, launch } = await launchAgent(`
    const { appendFileSync, readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    const addDirIndex = process.argv.indexOf("--add-dir");
    const agentArg = process.argv.find((arg) => arg.startsWith("--agent="));
    const agentDir = addDirIndex !== -1 ? process.argv[addDirIndex + 1] : null;
    const agentName = agentArg ? agentArg.slice("--agent=".length) : null;
    const agentDefinition =
      agentDir && agentName
        ? readFileSync(join(agentDir, ".agents", "agents", agentName, "agent.md"), "utf8")
        : null;
    appendFileSync(
      process.env.CAPTURE,
      JSON.stringify({ kind: "launch", argv: process.argv.slice(2), agentDir, agentName, agentDefinition }) + "\\n",
    );
    const configOptions = [
      { id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-neon",
        options: [{ value: "gemini-4-neon", name: "Gemini 4 Neon" }, { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }] },
      { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "auto",
        options: [{ value: "default", name: "Default" }, { value: "auto", name: "Auto" }, { value: "plan", name: "Plan" }] },
    ];
    let pendingPromptId = null;
    createInterface({ input: process.stdin }).on("line", (line) => {
      appendFileSync(process.env.CAPTURE, line + "\\n");
      const msg = JSON.parse(line);
      if (msg.id === 99 && pendingPromptId !== null) {
        send({
          method: "session/update",
          params: {
            sessionId: "restricted-1",
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(msg.result) } },
          },
        });
        send({ id: pendingPromptId, result: { stopReason: "end_turn" } });
        pendingPromptId = null;
        return;
      }
      switch (msg.method) {
        case "initialize":
          send({
            id: msg.id,
            result: {
              protocolVersion: 1,
              agentCapabilities: {
                loadSession: true,
                _meta: {
                  antigravity: {
                    systemPrompt: { append: process.env.DISABLE_APPEND !== "1" },
                  },
                },
              },
            },
          });
          break;
        case "session/new":
          send({ id: msg.id, result: { sessionId: "restricted-1", configOptions } });
          break;
        case "session/set_config_option": {
          const option = configOptions.find((entry) => entry.id === msg.params.configId);
          if (!option) {
            send({ id: msg.id, error: { code: -32602, message: "Unknown option " + msg.params.configId } });
            break;
          }
          option.currentValue = msg.params.value;
          send({ id: msg.id, result: { configOptions } });
          break;
        }
        case "session/prompt":
          pendingPromptId = msg.id;
          send({
            id: 99,
            method: "session/request_permission",
            params: {
              sessionId: "restricted-1",
              toolCall: {
                toolCallId: "tc-1",
                title: "Run command",
                kind: "execute",
                status: "pending",
                content: [],
                rawInput: {},
              },
              options: [
                { optionId: "allow", name: "Allow", kind: "allow_once" },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
            },
          });
          break;
        case "session/close":
          send({ id: msg.id, result: {} });
          break;
      }
    });
  `);
  const provider = createAntigravityProvider();
  const connection = await provider.connect({
    launch: {
      ...launch,
      args: [
        ...launch.args,
        "-dangerously-skip-permissions",
        "--agent",
        "-dangerously-skip-permissions",
        "--ide-mcp-port=9999",
        "--include-default-customizations=true",
        "--",
        "extra-positional",
      ],
    },
    versions: [1],
    capabilities: ["prompt.message", "session.configure", "session.persistence", "permission"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  let capturedAgentDir: string | null = null;
  try {
    await connection.send({
      type: "session.open",
      requestId: "open-restricted",
      sessionId: "restricted-session",
      history: "skip",
      config: {
        cwd: directory,
        model: "gemini-3.8-flash",
        systemPrompt: "Title instructions",
        env: {},
        mcpServers: {},
        settings: { restrictToConfiguredMcp: true },
        providerOptions: { restrictToConfiguredMcp: true },
        persist: false,
      },
    });
    await expect
      .poll(
        () =>
          events.find((event) => event.type === "session.ready" || event.type === "request.failed"),
        { timeout: 3_000 },
      )
      .toMatchObject({ type: "session.ready" });

    // Full-access mode must not be advertised or enabled on restricted sessions; mode is forced to default.
    const configEvent = events.findLast((event) => event.type === "session.config");
    expect(configEvent?.config.mode).toBe("default");
    expect(configEvent?.config.modes.map((mode) => mode.id)).not.toContain("full-access");

    // Switching out of default mode is rejected.
    await connection.send({
      type: "session.configure",
      requestId: "switch-auto",
      sessionId: "restricted-session",
      changes: { mode: "auto" },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) => event.type === "request.failed" && event.requestId === "switch-auto",
          ),
        { timeout: 3_000 },
      )
      .toMatchObject({
        type: "request.failed",
        error: { message: expect.stringContaining("Unattended modes") },
      });

    await connection.send({
      type: "session.prompt",
      sessionId: "restricted-session",
      prompt: {
        clientMessageId: "title-turn",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "Name this chat" }] },
      },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) =>
              event.type === "session.turn" &&
              event.turnId === "acp:title-turn" &&
              event.state === "completed",
          ),
        { timeout: 3_000 },
      )
      .toBeDefined();

    // Restricted sessions must never emit permission prompts or auto-allow them.
    expect(events.some((event) => event.type === "session.permission")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({
          type: "assistant_message",
          text: JSON.stringify({ outcome: { outcome: "selected", optionId: "reject" } }),
        }),
      }),
    );

    const captured = (await readFile(launch.env.CAPTURE, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const launchRecord = captured.findLast((entry) => entry.kind === "launch");
    expect(launchRecord.argv).toEqual([
      "acp",
      "--disable-telemetry",
      "--dangerously-skip-permissions=false",
      "--include-default-customizations=false",
      "--add-dir",
      launchRecord.agentDir,
      `--agent=${launchRecord.agentName}`,
    ]);
    expect(launchRecord.agentName).toMatch(/^paseo-restricted-/);
    expect(launchRecord.agentDefinition).toContain("inheritCustomizations: false");
    expect(launchRecord.agentDefinition).toContain("excludeDefaultComponents: true");
    expect(launchRecord.agentDefinition).toContain("tools: []");
    expect(launchRecord.agentDefinition).toContain("mcpServers: []");
    expect(launchRecord.agentDefinition).toContain("skills: []");
    expect(launchRecord.agentDefinition).toContain("rules: []");
    expect(launchRecord.agentDefinition).toContain("plugins: []");
    capturedAgentDir = launchRecord.agentDir;
    expect(capturedAgentDir).toBeTruthy();

    // Forces mode=default and model=gemini-3.8-flash without sending restrictToConfiguredMcp.
    const configOptionCalls = captured.filter(
      (entry) => entry.method === "session/set_config_option",
    );
    expect(configOptionCalls.map((entry) => [entry.params.configId, entry.params.value])).toEqual([
      ["model", "gemini-3.8-flash"],
      ["mode", "default"],
    ]);

    // Rejects nonempty configured MCP servers and persisted session loads in restricted sessions.
    await connection.send({
      type: "session.open",
      requestId: "open-with-mcp",
      sessionId: "restricted-with-mcp",
      history: "skip",
      config: {
        cwd: directory,
        env: {},
        mcpServers: { injected: { type: "http", url: "http://127.0.0.1:1" } },
        settings: {},
        providerOptions: { restrictToConfiguredMcp: true },
        persist: false,
      },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) => event.type === "request.failed" && event.requestId === "open-with-mcp",
          ),
        { timeout: 3_000 },
      )
      .toMatchObject({
        type: "request.failed",
        error: { message: expect.stringContaining("tool-free planning") },
      });

    await connection.send({
      type: "session.open",
      requestId: "open-persisted",
      sessionId: "restricted-persisted",
      history: "replay",
      persistence: { version: 1, data: { sessionId: "saved" } },
      config: {
        cwd: directory,
        env: {},
        mcpServers: {},
        settings: {},
        providerOptions: { restrictToConfiguredMcp: true },
        persist: true,
      },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) => event.type === "request.failed" && event.requestId === "open-persisted",
          ),
        { timeout: 3_000 },
      )
      .toMatchObject({
        type: "request.failed",
        error: { message: expect.stringContaining("persisted sessions") },
      });
  } finally {
    await connection.close();
  }
  expect(capturedAgentDir).not.toBeNull();
  if (capturedAgentDir) {
    await expect(access(capturedAgentDir)).rejects.toThrow();
  }

  // Fails closed if flags appear before acp or if the CLI lacks systemPrompt.append.
  const preAcpConnection = await provider.connect({
    launch: {
      ...launch,
      args: [launch.args[0] ?? "", "--settings=/tmp/evil.json", "acp"],
    },
    versions: [1],
    capabilities: ["prompt.message"],
  });
  const preAcpEvents: ProviderEvent[] = [];
  preAcpConnection.onEvent((event) => preAcpEvents.push(event));
  try {
    await preAcpConnection.send({
      type: "session.open",
      requestId: "pre-acp-flags",
      sessionId: "s1",
      history: "skip",
      config: {
        cwd: directory,
        env: {},
        mcpServers: {},
        settings: {},
        providerOptions: { restrictToConfiguredMcp: true },
        persist: false,
      },
    });
    await expect
      .poll(() => preAcpEvents.find((event) => event.type === "request.failed"), { timeout: 3_000 })
      .toMatchObject({
        type: "request.failed",
        error: { message: expect.stringContaining("before the acp subcommand") },
      });
  } finally {
    await preAcpConnection.close();
  }

  const legacyCliConnection = await provider.connect({
    launch: { ...launch, env: { ...launch.env, DISABLE_APPEND: "1" } },
    versions: [1],
    capabilities: ["prompt.message"],
  });
  const legacyEvents: ProviderEvent[] = [];
  legacyCliConnection.onEvent((event) => legacyEvents.push(event));
  try {
    await legacyCliConnection.send({
      type: "session.open",
      requestId: "no-append",
      sessionId: "s2",
      history: "skip",
      config: {
        cwd: directory,
        systemPrompt: "Title instructions",
        env: {},
        mcpServers: {},
        settings: {},
        providerOptions: { restrictToConfiguredMcp: true },
        persist: false,
      },
    });
    await expect
      .poll(() => legacyEvents.find((event) => event.type === "request.failed"), { timeout: 3_000 })
      .toMatchObject({
        type: "request.failed",
        error: { message: expect.stringContaining("system prompt injection") },
      });
  } finally {
    await legacyCliConnection.close();
  }
});

it("reuses one warm agy acp process across Paseo/genui sessions and injects the literal thread storage path", async () => {
  const { directory, launch } = await launchAgent(`
    const { appendFileSync } = require("node:fs");
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    appendFileSync(
      process.env.CAPTURE,
      JSON.stringify({
        kind: "boot",
        pid: process.pid,
        bbStorage: process.env.BB_THREAD_STORAGE ?? null,
        custom: process.env.CUSTOM_AGY_ENV ?? null,
      }) + "\\n",
    );
    let seq = 0;
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      appendFileSync(process.env.CAPTURE, JSON.stringify({ kind: "rpc", pid: process.pid, method, params }) + "\\n");
      switch (method) {
        case "initialize":
          send({ id, result: { protocolVersion: 1, agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { close: {} },
            _meta: { antigravity: { systemPrompt: { append: true } } },
          } } });
          break;
        case "session/new": {
          const sessionId = "agy-" + (++seq);
          send({ id, result: { sessionId, modes: {
            currentModeId: "default", availableModes: [{ id: "default", name: "Default" }],
          } } });
          send({ method: "session/update", params: { sessionId, update: {
            sessionUpdate: "available_commands_update", availableCommands: [],
          } } });
          break;
        }
        case "session/close":
          send({ id, result: {} });
          break;
      }
    });
  `);
  const connection = await createAntigravityProvider().connect({
    launch,
    versions: [1],
    capabilities: ["prompt.message"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({ type: "catalog", requestId: "cat", cwd: directory });
    await expect
      .poll(() => events.find((event) => event.type === "catalog" && event.requestId === "cat"))
      .toBeDefined();

    await connection.send({
      type: "session.open",
      requestId: "open-1",
      sessionId: "chat-1",
      history: "skip",
      config: {
        cwd: directory,
        systemPrompt: "Base prompt",
        env: {
          PASEO_AGENT_ID: "agent-1",
          PASEO_AGENT_CWD: directory,
          PASEO_WORKSPACE_ID: "wks-1",
          BB_THREAD_STORAGE: "/tmp/opencode/genui-storage/agent-1",
          PASEO_THREAD_STORAGE: "/tmp/opencode/genui-storage/agent-1",
        },
        mcpServers: {},
        settings: {},
        persist: false,
      },
    });
    await connection.send({
      type: "session.open",
      requestId: "open-2",
      sessionId: "chat-2",
      history: "skip",
      config: {
        cwd: directory,
        systemPrompt: "Second prompt",
        env: {
          PASEO_AGENT_ID: "agent-2",
          PASEO_AGENT_CWD: directory,
          PASEO_WORKSPACE_ID: "wks-2",
          BB_THREAD_STORAGE: "/tmp/opencode/genui-storage/agent-2",
          PASEO_THREAD_STORAGE: "/tmp/opencode/genui-storage/agent-2",
        },
        mcpServers: {},
        settings: {},
        persist: false,
      },
    });
    await expect
      .poll(() =>
        events.find((event) => event.type === "session.ready" && event.sessionId === "chat-1"),
      )
      .toBeDefined();
    await expect
      .poll(() =>
        events.find((event) => event.type === "session.ready" && event.sessionId === "chat-2"),
      )
      .toBeDefined();

    // Non-ignored custom env still spawns an isolated dedicated process without adding the shared-process hint.
    await connection.send({
      type: "session.open",
      requestId: "open-3",
      sessionId: "chat-isolated",
      history: "skip",
      config: {
        cwd: directory,
        systemPrompt: "Isolated prompt",
        env: {
          CUSTOM_AGY_ENV: "yes",
          BB_THREAD_STORAGE: "/tmp/opencode/genui-storage/agent-3",
        },
        mcpServers: {},
        settings: {},
        persist: false,
      },
    });
    await expect
      .poll(() =>
        events.find(
          (event) => event.type === "session.ready" && event.sessionId === "chat-isolated",
        ),
      )
      .toBeDefined();

    const captured = (await readFile(launch.env.CAPTURE, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const boots = captured.filter((entry) => entry.kind === "boot");
    expect(boots).toHaveLength(2);
    expect(boots[0].bbStorage).toContain("genui-storage");
    expect(boots[0].custom).toBeNull();
    expect(boots[1].custom).toBe("yes");

    const newCalls = captured.filter(
      (entry) =>
        entry.kind === "rpc" && entry.method === "session/new" && entry.params?._meta?.antigravity,
    );
    expect(newCalls).toHaveLength(3);
    expect(newCalls[0].pid).toBe(boots[0].pid);
    expect(newCalls[1].pid).toBe(boots[0].pid);
    expect(newCalls[2].pid).toBe(boots[1].pid);
    expect(newCalls[0].params._meta.antigravity.systemPrompt.append).toContain(
      "/tmp/opencode/genui-storage/agent-1",
    );
    expect(newCalls[1].params._meta.antigravity.systemPrompt.append).toContain(
      "/tmp/opencode/genui-storage/agent-2",
    );
    expect(newCalls[2].params._meta.antigravity.systemPrompt.append).toBe("Isolated prompt");
  } finally {
    await connection.close();
  }
});
