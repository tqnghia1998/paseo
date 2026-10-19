import { z } from "zod";
import type { Logger } from "pino";
import type { AgentSessionConfig } from "../../../server/agent/agent-sdk-types.js";
import type { CodexAppServerClient } from "../../../server/agent/providers/codex/app-server-transport.js";
import { composeSystemPromptParts } from "../../../server/agent/system-prompt.js";

const CODEX_QUESTION_INSTRUCTIONS =
  "Use request_user_input for user questions and wait for the user's answer before continuing. " +
  "Do not use request_user_input_async or send_user_message_async to ask questions; those tools return before the user answers. " +
  "If request_user_input is unavailable, ask the question in your final message and end the turn. " +
  "Never assume a default answer or treat a preselected option as the user's response.";

type QuestionSession = Pick<
  AgentSessionConfig,
  "systemPrompt" | "daemonAppendSystemPrompt" | "internal" | "cwd"
>;
interface DeveloperInstructionsInput {
  session: QuestionSession;
  nativeInstructions?: string;
  modeInstructions?: string | null;
}

export function buildCodexDeveloperInstructions(
  input: DeveloperInstructionsInput,
): string | undefined {
  const { session, nativeInstructions, modeInstructions } = input;
  const paseoInstructions = composeSystemPromptParts(
    session.systemPrompt,
    session.daemonAppendSystemPrompt,
  );
  return composeSystemPromptParts(
    modeInstructions,
    paseoInstructions ?? (session.internal ? undefined : nativeInstructions),
    session.internal ? undefined : CODEX_QUESTION_INSTRUCTIONS,
  );
}

const NativeConfigSchema = z.object({
  config: z.object({
    developer_instructions: z.string().nullish(),
    sandbox_workspace_write: z.unknown().optional(),
  }),
});
interface ReadNativeConfigInput {
  client: Pick<CodexAppServerClient, "request">;
  session: QuestionSession;
  logger: Logger;
}

export async function readNativeCodexConfig(input: ReadNativeConfigInput) {
  const { client, session, logger } = input;
  try {
    const response = await client.request("config/read", { cwd: session.cwd ?? null });
    return NativeConfigSchema.parse(response).config;
  } catch (error) {
    const paseoInstructions = composeSystemPromptParts(
      session.systemPrompt,
      session.daemonAppendSystemPrompt,
    );
    if (!session.internal && !paseoInstructions) {
      throw new Error(
        "Cannot preserve native Codex developer instructions: configuration read failed",
        { cause: error },
      );
    }
    logger.debug({ error }, "Failed to read resolved Codex config");
    return undefined;
  }
}
