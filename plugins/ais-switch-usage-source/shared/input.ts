import { z } from "zod";

export const inputSchema = z
  .object({
    path: z.string().min(1),
    binaryPath: z.string().min(1),
    accountKey: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AISUsageInput = z.infer<typeof inputSchema>;
