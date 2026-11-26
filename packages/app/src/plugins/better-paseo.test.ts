// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePlugin } from "../../../server/src/server/plugins/compiler";
import { runPluginClientBundle, type PluginClientRuntime } from "./evaluate";

const runtime = {
  paseo: {
    agents: {
      async list() {
        return {
          entries: [],
          pageInfo: { hasMore: false, nextCursor: null },
          subscription: { subscribe() {} },
        };
      },
    },
    workspaces: {
      async list() {
        return {
          entries: [],
          pageInfo: { hasMore: false, nextCursor: null },
          subscription: { subscribe() {} },
        };
      },
    },
    providers: {
      async snapshot() {
        return { entries: [] };
      },
      subscribe() {
        return () => {};
      },
    },
    observeEvents() {
      return {
        ready: Promise.resolve(),
        release() {},
        subscribe() {
          return () => {};
        },
      };
    },
  },
  async rpc() {
    return {};
  },
  openSettings() {},
  openScreen() {},
  openSurface() {},
  openPanel() {},
} as unknown as PluginClientRuntime;

describe("bundled Better Paseo", () => {
  it("registers the Tasks Kanban screen and timeline transformers and cleans up", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const { clientBundle } = await compilePlugin({
      client: path.resolve(here, "../../../../plugins/better-paseo/index.client.ts"),
      server: null,
    });
    const plugin = runPluginClientBundle("better-paseo", clientBundle!, runtime);
    try {
      expect(plugin.timelineTransformers.length).toBeGreaterThan(0);
      expect(plugin.surfaces.map(({ id }) => id)).toContain("tasks");
      const assistantTransformer = plugin.timelineTransformers.find(
        ({ id }) => id === "omp-enhanced-assistant",
      ) as unknown as
        | {
            transform(input: {
              item: { type: "assistant_message"; text: string };
              phase: "complete";
            }): unknown;
          }
        | undefined;
      expect(assistantTransformer).toBeDefined();
      expect(
        assistantTransformer!.transform({
          item: { type: "assistant_message", text: 'Summary\n\n```ui\nCard("Hi", [])\n```' },
          phase: "complete",
        }),
      ).toBeUndefined();
      expect(
        assistantTransformer!.transform({
          item: { type: "assistant_message", text: "```app\n<html></html>\n```" },
          phase: "complete",
        }),
      ).toBeUndefined();
      expect(
        assistantTransformer!.transform({
          item: { type: "assistant_message", text: "Plain **markdown** reply" },
          phase: "complete",
        }),
      ).toBeDefined();

      const toolTransformer = plugin.timelineTransformers.find(
        ({ id }) => id === "omp-enhanced-tool-call",
      ) as unknown as
        | {
            transform(input: {
              item: {
                type: "tool_call";
                callId: string;
                name: string;
                status: "running" | "completed" | "failed";
                error: string | null;
                detail: Record<string, unknown>;
              };
              phase: "streaming" | "complete";
            }): unknown;
          }
        | undefined;
      expect(toolTransformer).toBeDefined();
      expect(
        toolTransformer!.transform({
          item: {
            type: "tool_call",
            callId: "c1",
            name: "mcp__bots__propose_routine",
            status: "completed",
            error: null,
            detail: { type: "mcp", output: "Created proposal p-0123456789 for review." },
          },
          phase: "complete",
        }),
      ).toBeUndefined();
      expect(
        toolTransformer!.transform({
          item: {
            type: "tool_call",
            callId: "c2",
            name: "bots__show_card",
            status: "completed",
            error: null,
            detail: {
              type: "mcp",
              output: JSON.stringify({
                cardId: "i-0123456789abcdef01234567",
                status: "pending",
              }),
            },
          },
          phase: "complete",
        }),
      ).toBeUndefined();
      expect(
        toolTransformer!.transform({
          item: {
            type: "tool_call",
            callId: "c3",
            name: "mcp__composio__COMPOSIO_MANAGE_CONNECTIONS",
            status: "completed",
            error: null,
            detail: {
              type: "mcp",
              output: {
                data: {
                  results: {
                    github: { redirect_url: "https://backend.composio.dev/api/v3/s/abc" },
                  },
                },
              },
            },
          },
          phase: "complete",
        }),
      ).toBeUndefined();
      expect(
        toolTransformer!.transform({
          item: {
            type: "tool_call",
            callId: "c4",
            name: "mcp__bots__list_bots",
            status: "completed",
            error: null,
            detail: { type: "mcp", output: "[]" },
          },
          phase: "complete",
        }),
      ).toEqual({ items: [] });
    } finally {
      await plugin.cleanup();
    }
    expect(plugin.timelineTransformers).toEqual([]);
    expect(plugin.surfaces).toEqual([]);
  }, 30_000);
});
