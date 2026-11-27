import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import {
  runAcpProvider,
  type AcpConfigChange,
  type AcpConfigureContext,
  type AcpTransformer,
} from "@getpaseo/plugin/server/acp";
import {
  PROVIDER_PROTOCOL_VERSION,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderInstallationLaunch,
  type ProviderLaunch,
  type ProviderRegistration,
} from "@getpaseo/plugin/server/provider";
import { z } from "zod";
import { mapToolCall } from "./tool-calls.js";

const legacySession = z.object({
  version: z.literal(1),
  data: z.object({ conversationId: z.string().min(1) }),
});
const systemPromptCapability = z.object({
  antigravity: z.object({ systemPrompt: z.object({ append: z.literal(true) }) }),
});

// agy 1.5.13 advertises these built-in commands and its invocable skills in one ACP list.
const builtInCommands = new Set([
  "goal",
  "compact",
  "schedule",
  "browser",
  "plan",
  "grill-me",
  "teamwork",
  "learn",
  "boost",
]);

// Per-session Paseo/genui metadata env vars that should not force a fresh `agy acp` process.
// Any other per-session env override still gets a dedicated process.
const SHARED_PROCESS_IGNORED_ENV_KEYS = [
  "PASEO_AGENT_ID",
  "PASEO_AGENT_CWD",
  "PASEO_WORKSPACE_ID",
  "BB_THREAD_STORAGE",
  "PASEO_THREAD_STORAGE",
] as const;

const SHARED_THREAD_STORAGE_DIR =
  process.platform === "win32"
    ? path.join(tmpdir(), "opencode", "genui-storage", "shared")
    : "/tmp/opencode/genui-storage/shared";

function buildAppendedSystemPrompt(
  systemPrompt: string | undefined,
  env: Readonly<Record<string, string>> | undefined,
  sharedProcess: boolean | undefined,
): string | undefined {
  const threadStorageDir = sharedProcess
    ? (env?.BB_THREAD_STORAGE ?? env?.PASEO_THREAD_STORAGE)?.trim() || undefined
    : undefined;
  const storageHint = threadStorageDir
    ? `This session shares a warm Antigravity process; use the literal path ${threadStorageDir} instead of $BB_THREAD_STORAGE or $PASEO_THREAD_STORAGE in shell commands and Load() calls.`
    : undefined;
  if (systemPrompt && storageHint) return `${systemPrompt}\n\n${storageHint}`;
  return systemPrompt ?? storageHint;
}

async function configureLegacyModel(
  change: AcpConfigChange,
  { apply, catalog }: Pick<AcpConfigureContext, "apply" | "catalog">,
): Promise<"handled" | "pass"> {
  // COMPAT(antigravityStreamJson): added in v0.16.2, remove after 2027-11-19.
  if (change.target === "model" && change.value) {
    const legacyModel = /^(.*)-(xhigh|high|medium|low|minimal)$/.exec(change.value);
    if (legacyModel) {
      const { models } = catalog();
      const [, model, effort] = legacyModel;
      if (
        model &&
        effort &&
        !models.some((option) => option.id === change.value) &&
        models.some((option) => option.id === model)
      ) {
        await apply({ target: "model", value: model });
        if (catalog().thinkingOptions?.some((option) => option.id === effort)) {
          await apply({ target: "thinking", value: effort });
        }
        return "handled";
      }
    }
  }
  return "pass";
}

const antigravity: AcpTransformer = {
  command(command) {
    return { ...command, kind: builtInCommands.has(command.name) ? "command" : "skill" };
  },
  toolCall: mapToolCall,
  sessionOpen({ persistence, systemPrompt, agentMetadata, env, sharedProcess }) {
    // COMPAT(antigravityStreamJson): added in v0.16.2, remove after 2027-11-19.
    const saved = legacySession.safeParse(persistence);
    const appendedPrompt = buildAppendedSystemPrompt(systemPrompt, env, sharedProcess);
    return {
      sessionId: saved.success ? saved.data.data.conversationId : undefined,
      metadata:
        appendedPrompt && systemPromptCapability.safeParse(agentMetadata).success
          ? { antigravity: { systemPrompt: { append: appendedPrompt } } }
          : undefined,
    };
  },
  configure: configureLegacyModel,
};

const restrictedAntigravity: AcpTransformer = {
  toolCall: mapToolCall,
  sessionOpen({ persistence, systemPrompt, agentMetadata }) {
    if (persistence !== undefined) {
      throw new Error("Restricted Antigravity sessions cannot load or resume persisted sessions");
    }
    if (systemPrompt) {
      if (!systemPromptCapability.safeParse(agentMetadata).success) {
        throw new Error(
          "Antigravity restricted sessions require a CLI version that supports system prompt injection",
        );
      }
      return { metadata: { antigravity: { systemPrompt: { append: systemPrompt } } } };
    }
    return {};
  },
  async configure(change, context) {
    if (change.target === "mode") {
      if (change.value !== "default") {
        throw new Error("Unattended modes are disabled in restricted Antigravity sessions");
      }
      if (!context.catalog().modes.some((mode) => mode.id === "default")) {
        return "handled";
      }
      return "pass";
    }
    return configureLegacyModel(change, context);
  },
};

function buildRestrictedLaunch(
  launch: ProviderLaunch | undefined,
  agentDir: string,
  agentName: string,
): ProviderLaunch {
  if (!launch) {
    throw new Error("Antigravity restricted sessions require a CLI launch");
  }
  const acpIndex = launch.args.indexOf("acp");
  if (acpIndex === -1) {
    throw new Error("Antigravity restricted sessions require the acp subcommand");
  }
  const prefix = launch.args.slice(0, acpIndex);
  if (prefix.some((arg) => arg.startsWith("-"))) {
    throw new Error(
      "Antigravity restricted sessions do not allow CLI flags before the acp subcommand",
    );
  }
  return {
    command: launch.command,
    env: launch.env,
    args: [
      ...prefix,
      "acp",
      "--disable-telemetry",
      "--dangerously-skip-permissions=false",
      "--include-default-customizations=false",
      "--add-dir",
      agentDir,
      `--agent=${agentName}`,
    ],
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The release `agy --version` reports, or its first line when it names no release. */
async function readAgyVersion(
  launch: ProviderInstallationLaunch,
  signal: AbortSignal,
): Promise<string | undefined> {
  // The launch ends with the `acp` subcommand and its flags; the version comes from the CLI itself.
  const acp = launch.args.indexOf("acp");
  const prefix = acp === -1 ? launch.args : launch.args.slice(0, acp);
  const { stdout } = await execCommand(launch.command, [...prefix, "--version"], {
    env: launch.env,
    timeout: 5000,
    maxBuffer: 8192,
    signal,
  });
  const firstLine = stdout.trim().split("\n")[0]?.trim();
  return /\b\d+\.\d+\.\d+\S*/.exec(stdout)?.[0] ?? (firstLine || undefined);
}

// agy 1.5.14 reads its sign-in from a token file when any of these is set, and from the OS keyring
// otherwise. https://github.com/google-antigravity/antigravity-cli/issues/1336
const sshSessionVariables = ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"];

/**
 * Report rows that say whether agy runs in an SSH session, because that decides which sign-in it
 * uses. The report does not wrap, so each row stays short enough to read without scrolling.
 */
function describeSignIn(env: Readonly<Record<string, string>>): string {
  const variable = sshSessionVariables.find((name) => env[name]);
  return variable
    ? `SSH session: yes (${variable})\nSign-in: can differ from agy outside SSH`
    : "SSH session: no\nSign-in: can differ from agy over SSH";
}

export function createAntigravityProvider(): ProviderRegistration {
  const baseCommand = ["agy", "acp", "--disable-telemetry"] as const;
  const provider = runAcpProvider({
    id: "antigravity",
    label: "Antigravity",
    description: "Antigravity CLI on your host",
    icon: "icon.svg",
    command: baseCommand,
    acpOptions: {
      // agy 1.5.14 lists thinking options for the selected model only, and none for Orchestrator.
      perModelThinkingOptions: true,
      waitForInitialCommands: true,
      loadReplayQuietPeriodMs: 200,
      // COMPAT(antigravityAcpV1DeferredTurn): added in v0.18.0, remove once Antigravity CLI supports ACP v2 state_update.
      deferTurnOnRunningTools: {
        keepsTurnOpen(toolCall) {
          const input = toolCall.input;
          if (typeof input !== "object" || input === null || Array.isArray(input)) return true;
          if (input.IsDaemon === true) return false;

          // agy leaves recurring schedules in progress after registering them.
          const recurringSchedule =
            toolCall.name === "schedule" &&
            typeof input.CronExpression === "string" &&
            input.CronExpression.trim().length > 0;
          return !recurringSchedule;
        },
      },
      autoAcceptMode: {
        mode: {
          id: "full-access",
          label: "Full access",
          description: "Approve tool requests without asking.",
          icon: "ShieldOff",
          colorTier: "dangerous",
        },
        nativeMode: "default",
        default: true,
      },
      shareProcess: {
        ignoredEnvKeys: SHARED_PROCESS_IGNORED_ENV_KEYS,
        sharedEnv: {
          BB_THREAD_STORAGE: SHARED_THREAD_STORAGE_DIR,
          PASEO_THREAD_STORAGE: SHARED_THREAD_STORAGE_DIR,
        },
      },
    },
    transformers: [antigravity],
  });

  const restrictedProvider = runAcpProvider({
    id: "antigravity",
    label: "Antigravity",
    description: "Antigravity CLI on your host",
    icon: "icon.svg",
    command: baseCommand,
    acpOptions: {
      loadReplayQuietPeriodMs: 200,
      shareProcess: {
        ignoredEnvKeys: SHARED_PROCESS_IGNORED_ENV_KEYS,
      },
    },
    transformers: [restrictedAntigravity],
  });

  return {
    ...provider,
    async connect(request): Promise<ProviderConnection> {
      await mkdir(SHARED_THREAD_STORAGE_DIR, { recursive: true }).catch(() => undefined);
      const baseConnection = await provider.connect(request);
      const listeners = new Set<(event: ProviderEvent) => void>();
      const restrictedSessions = new Set<string>();
      const pendingRestrictedOpens = new Map<string, string>();
      let closed = false;
      let closePromise: Promise<void> | null = null;

      interface RestrictedRuntimeState {
        agentDir: string;
        connection: ProviderConnection;
        unsubscribe: () => void;
      }
      let restrictedPromise: Promise<RestrictedRuntimeState> | null = null;
      let restrictedIdleTimer: ReturnType<typeof setTimeout> | null = null;
      const configuredIdleMs = Number(
        (
          request.launch?.env?.PASEO_IDLE_RUNTIME_TIMEOUT_MS ??
          process.env.PASEO_IDLE_RUNTIME_TIMEOUT_MS ??
          ""
        ).trim(),
      );
      const restrictedIdleTimeoutMs =
        Number.isSafeInteger(configuredIdleMs) && configuredIdleMs > 0
          ? configuredIdleMs
          : 3 * 60_000;

      const clearRestrictedIdleTimer = () => {
        if (restrictedIdleTimer !== null) {
          clearTimeout(restrictedIdleTimer);
          restrictedIdleTimer = null;
        }
      };

      const closeRestrictedState = async (pending: Promise<RestrictedRuntimeState> | null) => {
        if (!pending) return;
        const state = await pending.catch(() => null);
        if (!state) return;
        try {
          await state.connection.close();
        } finally {
          state.unsubscribe();
          await rm(state.agentDir, { recursive: true, force: true }).catch(() => undefined);
        }
      };

      const scheduleRestrictedIdleReap = () => {
        clearRestrictedIdleTimer();
        if (
          closed ||
          !restrictedPromise ||
          restrictedSessions.size > 0 ||
          pendingRestrictedOpens.size > 0
        ) {
          return;
        }
        restrictedIdleTimer = setTimeout(() => {
          restrictedIdleTimer = null;
          if (
            closed ||
            !restrictedPromise ||
            restrictedSessions.size > 0 ||
            pendingRestrictedOpens.size > 0
          ) {
            return;
          }
          const expiring = restrictedPromise;
          restrictedPromise = null;
          void closeRestrictedState(expiring);
        }, restrictedIdleTimeoutMs);
        restrictedIdleTimer.unref?.();
      };

      const emit = (event: ProviderEvent) => {
        if (closed) return;
        for (const listener of listeners) listener(event);
      };

      const unsubscribeBase = baseConnection.onEvent((event) => emit(event));

      const getRestrictedState = (): Promise<RestrictedRuntimeState> => {
        clearRestrictedIdleTimer();
        if (restrictedPromise) return restrictedPromise;
        const init = (async (): Promise<RestrictedRuntimeState> => {
          const agentDir = await mkdtemp(path.join(tmpdir(), "paseo-antigravity-restricted-"));
          const agentName = `paseo-restricted-${randomUUID()}`;
          try {
            const restrictedLaunch = buildRestrictedLaunch(request.launch, agentDir, agentName);
            const definitionDir = path.join(agentDir, ".agents", "agents", agentName);
            await mkdir(definitionDir, { recursive: true });
            await writeFile(
              path.join(definitionDir, "agent.md"),
              [
                "---",
                `name: ${agentName}`,
                "description: Internal Paseo restricted tool-free agent",
                "mainAgent: true",
                "subagent: false",
                "inheritCustomizations: false",
                "excludeDefaultComponents: true",
                "tools: []",
                "mcpServers: []",
                "skills: []",
                "rules: []",
                "plugins: []",
                "---",
                "Follow the system instructions exactly. Do not use any tools.",
                "",
              ].join("\n"),
            );
            const restrictedConnection = await restrictedProvider.connect({
              ...request,
              capabilities: [...new Set([...request.capabilities, "permission"])],
              launch: restrictedLaunch,
            });
            try {
              if (closed) {
                await restrictedConnection.close();
                await rm(agentDir, { recursive: true, force: true }).catch(() => undefined);
                throw new Error("ACP provider connection is closed");
              }
              const unsubscribe = restrictedConnection.onEvent((event) => {
                if (event.type === "session.permission") {
                  void restrictedConnection
                    .send({
                      type: "session.permission",
                      permissionId: event.request.id,
                      sessionId: event.sessionId,
                      response: { behavior: "deny" },
                    })
                    .catch(() => undefined);
                  return;
                }
                if (event.type === "session.permission_resolved") {
                  return;
                }
                if (event.type === "session.opened") {
                  if (event.requestId) pendingRestrictedOpens.delete(event.requestId);
                } else if (event.type === "request.failed") {
                  const failedSessionId = pendingRestrictedOpens.get(event.requestId);
                  if (failedSessionId) {
                    pendingRestrictedOpens.delete(event.requestId);
                    restrictedSessions.delete(failedSessionId);
                    scheduleRestrictedIdleReap();
                  }
                } else if (event.type === "session.closed") {
                  restrictedSessions.delete(event.sessionId);
                  scheduleRestrictedIdleReap();
                }
                emit(event);
              });
              return { agentDir, connection: restrictedConnection, unsubscribe };
            } catch (error) {
              await restrictedConnection.close().catch(() => undefined);
              throw error;
            }
          } catch (error) {
            await rm(agentDir, { recursive: true, force: true }).catch(() => undefined);
            throw error;
          }
        })();
        const tracked = init.catch((error) => {
          if (restrictedPromise === tracked) restrictedPromise = null;
          throw error;
        });
        restrictedPromise = tracked;
        return tracked;
      };

      return {
        version: baseConnection.version,
        capabilities: baseConnection.capabilities,
        async send(input) {
          if (closed) throw new Error("ACP provider connection is closed");
          if (
            input.type === "session.open" &&
            input.config.providerOptions?.restrictToConfiguredMcp === true
          ) {
            if (restrictedSessions.has(input.sessionId)) {
              throw new Error(`Session already exists: ${input.sessionId}`);
            }
            if (Object.keys(input.config.mcpServers).length > 0) {
              emit({
                type: "request.failed",
                requestId: input.requestId,
                error: {
                  message: "Antigravity supports only tool-free planning in restricted sessions",
                },
              });
              return;
            }
            if (input.persistence !== undefined) {
              emit({
                type: "request.failed",
                requestId: input.requestId,
                error: {
                  message:
                    "Restricted Antigravity sessions cannot load or resume persisted sessions",
                },
              });
              return;
            }
            if (input.config.mode !== undefined && input.config.mode !== "default") {
              emit({
                type: "request.failed",
                requestId: input.requestId,
                error: {
                  message: "Unattended modes are disabled in restricted Antigravity sessions",
                },
              });
              return;
            }
            let state: RestrictedRuntimeState;
            try {
              state = await getRestrictedState();
            } catch (error) {
              emit({
                type: "request.failed",
                requestId: input.requestId,
                error: { message: describeError(error) },
              });
              return;
            }
            restrictedSessions.add(input.sessionId);
            pendingRestrictedOpens.set(input.requestId, input.sessionId);
            const { restrictToConfiguredMcp: _restricted, ...settings } = input.config.settings;
            try {
              await state.connection.send({
                ...input,
                config: {
                  ...input.config,
                  mode: "default",
                  mcpServers: {},
                  settings,
                },
              });
            } catch (error) {
              pendingRestrictedOpens.delete(input.requestId);
              restrictedSessions.delete(input.sessionId);
              scheduleRestrictedIdleReap();
              throw error;
            }
            return;
          }

          if ("sessionId" in input && restrictedSessions.has(input.sessionId)) {
            if (
              input.type === "session.configure" &&
              input.changes.mode !== undefined &&
              input.changes.mode !== "default"
            ) {
              emit({
                type: "request.failed",
                requestId: input.requestId,
                error: {
                  message: "Unattended modes are disabled in restricted Antigravity sessions",
                },
              });
              return;
            }
            const state = await getRestrictedState();
            await state.connection.send(input);
            return;
          }

          await baseConnection.send(input);
        },
        onEvent(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close() {
          if (closePromise) return closePromise;
          clearRestrictedIdleTimer();
          closed = true;
          closePromise = (async () => {
            const pendingRestricted = restrictedPromise;
            restrictedPromise = null;
            try {
              await baseConnection.close();
            } finally {
              unsubscribeBase();
              await closeRestrictedState(pendingRestricted);
              restrictedSessions.clear();
              pendingRestrictedOpens.clear();
              listeners.clear();
            }
          })();
          return closePromise;
        },
      };
    },
    docsUrl: "https://paseo.sh/docs/supported-providers/antigravity#troubleshooting",
    // agy documents no update command and no release source, so there is nothing to check or run.
    installation: {
      installUrl: "https://antigravity.google/docs/getting-started?tab=cli",
      async inspect({ launch, signal }) {
        if (!launch?.resolved) return { status: "not_installed" };
        const version = await readAgyVersion(launch, signal);
        return version ? { status: "installed", version } : { status: "installed" };
      },
    },
    async status({ launch }) {
      if (!launch) return { available: false, diagnostic: "Install Antigravity 1.5.0 or later." };
      // A sign-in problem can stop ACP from starting, so the report says which sign-in either way.
      const signIn = describeSignIn(launch.env);
      try {
        const connection = await provider.connect({
          launch,
          versions: [PROVIDER_PROTOCOL_VERSION],
          capabilities: [],
        });
        await connection.close();
        return { available: true, diagnostic: signIn };
      } catch {
        return {
          available: false,
          diagnostic: `Antigravity ACP did not start. Install Antigravity 1.5.0 or later. If you override the command, include the acp subcommand.\n${signIn}`,
        };
      }
    },
  };
}
