import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "../../server/agent/agent-sdk-types.js";

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Bind a reply to the complete native request, including its command and available actions. */
export function chiefInputToken(request: AgentPermissionRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

/** Credentials are not needed to ask a person what to do with a Bot request. */
export function chiefInputDisplay(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(chiefInputDisplay);
  const record = object(value);
  if (record)
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        /token|secret|password|authorization|cookie|api[-_]?key|credential/i.test(key)
          ? "[redacted]"
          : chiefInputDisplay(item),
      ]),
    );
  return typeof value === "string"
    ? value.replace(
        /\b(?:glpat-|ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
        "[redacted]",
      )
    : value;
}

const selectedActionId = z.string().min(1).max(200).optional();
const responseSchema = z.discriminatedUnion("behavior", [
  z
    .object({
      behavior: z.literal("allow"),
      selectedActionId,
      updatedInput: z
        .object({
          answers: z.record(
            z.string().min(1).max(200),
            z
              .string()
              .max(4000)
              .refine((value) => Boolean(value.trim())),
          ),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      behavior: z.literal("deny"),
      selectedActionId,
      message: z.string().max(4000).optional(),
    })
    .strict(),
]);

type InputResponse = z.infer<typeof responseSchema>;
function matchesNativeAction(request: AgentPermissionRequest, response: InputResponse) {
  if (!request.actions?.length) return response.selectedActionId === undefined;
  return request.actions.some(
    (action) => action.id === response.selectedActionId && action.behavior === response.behavior,
  );
}

function questionAnswers(
  request: AgentPermissionRequest,
  input: { answers: Record<string, string> } | undefined,
) {
  const questions = request.input?.questions ?? request.metadata?.questions;
  if (!input || !Array.isArray(questions) || !questions.length || questions.length > 20)
    return null;
  const headers = questions.map((question) => object(question)?.header);
  if (
    headers.some((header) => typeof header !== "string" || !header) ||
    new Set(headers).size !== headers.length ||
    Object.keys(input.answers).length !== headers.length ||
    headers.some((header) => !Object.hasOwn(input.answers, String(header)))
  )
    return null;
  return input.answers;
}

/** A response can choose a native action or answer known questions, never rewrite a tool call. */
export function chiefInputResponse(
  request: AgentPermissionRequest,
  value: unknown,
): AgentPermissionResponse | null {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success || !matchesNativeAction(request, parsed.data)) return null;
  const response = parsed.data;
  if (response.behavior === "deny") return response;
  if (request.kind !== "question") return response.updatedInput === undefined ? response : null;
  const answers = questionAnswers(request, response.updatedInput);
  if (!answers) return null;
  return {
    ...response,
    // Preserve provider-owned question metadata exactly as the native form does.
    updatedInput: { ...request.input, answers },
  };
}
