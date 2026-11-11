import type { ProviderOptions, ToolPolicy } from "@getpaseo/protocol/agent-types";
import { z } from "zod";

const ApprovalPolicySchema = z.union([
  z.enum(["untrusted", "on-request", "never"]),
  z
    .object({
      granular: z
        .object({
          sandbox_approval: z.boolean().optional(),
          rules: z.boolean().optional(),
          mcp_elicitations: z.boolean().optional(),
          request_permissions: z.boolean().optional(),
          skill_approval: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
]);

const NetworkPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    proxy_url: z.string().optional(),
    socks_url: z.string().optional(),
    enable_socks5: z.boolean().optional(),
    enable_socks5_udp: z.boolean().optional(),
    allow_local_binding: z.boolean().optional(),
    allow_upstream_proxy: z.boolean().optional(),
    dangerously_allow_all_unix_sockets: z.boolean().optional(),
    dangerously_allow_non_loopback_proxy: z.boolean().optional(),
    domains: z.record(z.string(), z.enum(["allow", "deny"])).optional(),
    unix_sockets: z.record(z.string(), z.enum(["allow", "deny"])).optional(),
  })
  .strict();

// Codex config reference, maintained against Codex CLI 0.143+.
export const CodexProviderOptionsSchema = z
  .object({
    restrictToConfiguredMcp: z.boolean().optional(),
    // Composer controls, not Codex config: the provider reads them and keeps them out of `config`.
    service_tier: z.string().optional(),
    plan_mode: z.boolean().optional(),
    approval_policy: ApprovalPolicySchema.optional(),
    sandbox_mode: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
    sandbox_workspace_write: z
      .object({
        writable_roots: z.array(z.string()).optional(),
        network_access: z.boolean().optional(),
        exclude_slash_tmp: z.boolean().optional(),
        exclude_tmpdir_env_var: z.boolean().optional(),
      })
      .strict()
      .optional(),
    web_search: z.enum(["disabled", "cached", "indexed", "live"]).optional(),
    features: z
      .object({
        default_mode_request_user_input: z.boolean().optional(),
        network_proxy: z.union([z.boolean(), NetworkPolicySchema]).optional(),
        multi_agent_v2: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict() satisfies z.ZodType<ProviderOptions>;

export type CodexProviderOptions = z.infer<typeof CodexProviderOptionsSchema>;

export function applyCodexToolPolicy(
  config: Record<string, unknown>,
  toolPolicy: ToolPolicy | undefined,
  nativeConfig: Record<string, unknown> = {},
): Record<string, unknown> {
  if (config.restrictToConfiguredMcp === true) {
    const { restrictToConfiguredMcp: _restricted, ...connection } = config;
    const disable = (value: unknown, requested: unknown) =>
      Object.fromEntries(
        [
          ...new Set([...Object.keys(readRecord(value)), ...Object.keys(readRecord(requested))]),
        ].map((name) => [name, { enabled: false }]),
      );
    const featureNames = new Set([
      ...Object.keys(readRecord(nativeConfig.features)),
      ...Object.keys(readRecord(config.features)),
      "shell_tool",
      "apps",
      "plugins",
      "multi_agent",
      "multi_agent_v2",
      "collab",
      "js_repl",
      "node_repl",
      "code_mode",
      "code_mode_only",
      "view_image",
      "image_generation",
      "request_permissions_tool",
      "default_mode_request_user_input",
      "skill_mcp_dependency_install",
      "tool_suggest",
      "goals",
      "memory_tool",
    ]);
    return {
      ...connection,
      approval_policy: "never",
      sandbox_mode: "read-only",
      web_search: "disabled",
      features: Object.fromEntries([...featureNames].map((name) => [name, false])),
      mcp_servers: disable(nativeConfig.mcp_servers, config.mcp_servers),
      plugins: disable(nativeConfig.plugins, config.plugins),
      apps: { ...disable(nativeConfig.apps, config.apps), _default: { enabled: false } },
      tools: {
        update_plan: { enabled: false },
        experimental_request_user_input: { enabled: false },
      },
      project_doc_max_bytes: 0,
    };
  }
  if (!toolPolicy) return config;
  const mcpServers = readRecord(config.mcp_servers);
  const grantsByServer = new Map<string, string[]>();
  for (const grant of toolPolicy.preapproved) {
    const tools = grantsByServer.get(grant.server) ?? [];
    tools.push(grant.tool);
    grantsByServer.set(grant.server, tools);
  }
  for (const [server, tools] of grantsByServer) {
    const serverConfig = readRecord(mcpServers[server]);
    const approvals = Object.fromEntries(tools.map((tool) => [tool, { approval_mode: "approve" }]));
    mcpServers[server] = {
      ...serverConfig,
      enabled_tools: tools,
      default_tools_approval_mode: "prompt",
      tools: approvals,
    };
  }
  return { ...config, mcp_servers: mcpServers };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}
