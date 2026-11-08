import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const CHIEF_BOT_ID = "vibing-chief";
// Chief's own Bot tools: who can take a task, its memory and its history. It has no skills (its
// configuration is owned by source and cannot be edited) and never reads the Bot setup.
// Feature replies use the gateway chat reader.
export const CHIEF_BOT_TOOLS = [
  "list_bots",
  "search_chats",
  "read_memory",
  "write_memory",
] as const;

export function registerChiefBotTools(
  server: McpServer,
  call: (tool: string, args: unknown) => Promise<string>,
) {
  const tools: Array<{
    name: (typeof CHIEF_BOT_TOOLS)[number];
    description: string;
    inputSchema: Record<string, z.ZodType>;
  }> = [
    {
      name: "list_bots",
      description: "List the Bots that can take a feature task (name, id and what each does).",
      inputSchema: {},
    },
    {
      name: "search_chats",
      description: "Search Chief's own past chats and daily memory logs.",
      inputSchema: {
        query: z.string().max(200).optional(),
        since: z.string().max(20).optional(),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    {
      name: "read_memory",
      description: "Read Chief's own MEMORY.md or a named memory topic.",
      inputSchema: {
        name: z
          .string()
          .regex(/^[A-Za-z0-9 ._-]+\.md$/)
          .max(128)
          .default("MEMORY.md"),
      },
    },
    {
      name: "write_memory",
      description: "Save a durable preference or fact in Chief's own memory; never save secrets.",
      inputSchema: {
        name: z
          .string()
          .regex(/^[A-Za-z0-9 ._-]+\.md$/)
          .max(128)
          .default("MEMORY.md"),
        text: z.string().max(200_000),
      },
    },
  ];
  for (const tool of tools)
    server.registerTool(tool.name, tool, async (args) => ({
      content: [
        {
          type: "text",
          text: await call(tool.name, z.object(tool.inputSchema).strict().parse(args)),
        },
      ],
    }));
}

/** Only the daemon owns this capability. It never enters an agent or frame config. */
export function createChiefBotBridge(
  invoke: (method: string, input: Record<string, unknown>) => Promise<unknown>,
) {
  const bridgeToken = randomBytes(32).toString("hex");
  let identity: { agentId: string; cwd: string } | null = null;
  const prepare = async (next = identity): Promise<string> => {
    if (!next) throw new Error("Chief broker identity is not initialized");
    identity = { ...next };
    const result = await invoke("bots.chief.prepare", {
      bridgeToken,
      ...identity,
    });
    return z.object({ systemPrompt: z.string().max(250_000) }).parse(result).systemPrompt;
  };
  const boundCall = async (method: string, input: Record<string, unknown>) => {
    try {
      return await invoke(method, { ...input, bridgeToken });
    } catch (error) {
      // Only this explicit pre-dispatch rejection is safe to retry after a plugin restart.
      if (!(error instanceof Error) || !error.message.includes("Chief broker authorization failed"))
        throw error;
      await prepare();
      return invoke(method, { ...input, bridgeToken });
    }
  };
  return {
    prepare,
    async call(agentId: string, tool: string, args: unknown): Promise<string> {
      if (identity && identity.agentId !== agentId)
        throw new Error("Chief broker identity changed");
      if (!(CHIEF_BOT_TOOLS as readonly string[]).includes(tool))
        throw new Error("Unsupported Chief Bot tool");
      const result = await boundCall("bots.chief.call", {
        agentId,
        tool,
        arguments: args,
      });
      return z.object({ text: z.string().max(500_000) }).parse(result).text;
    },
    /**
     * Starts an ordinary Bot chat in a feature workspace, listed under that Bot in the
     * feature's Bots sidebar. The Bot keeps its own runtime, tools and permissions.
     */
    async handoff(input: {
      agentId: string;
      bot: string;
      path: string;
      workspaceId: string;
      prompt: string;
      titleSuffix: string;
      labels: Record<string, string>;
    }) {
      return z
        .object({
          chatId: z.string().min(1),
          botId: z.string().min(1),
          name: z.string(),
        })
        .parse(await boundCall("bots.chief.handoff", { ...input }));
    },
  };
}
