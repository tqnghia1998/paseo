import { createDecipheriv } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import { z } from "zod";
import type { AISUsageInput } from "../shared/input.js";

export const ORIGIN = "https://compass.llm.shopee.io";
const HEADER = Buffer.from("AISCQP\x01\x00");
const KEY_MARKER = Buffer.from("AIS Switch CQP credentials v1\0\xc0\0", "latin1");
const AAD = Buffer.from(`AIS Switch CQP credentials v1\0${ORIGIN}`);

const credentialsSchema = z.object({
  version: z.literal(1),
  origin: z.literal(ORIGIN),
  account: z.object({
    user_id: z.string().min(1),
    email: z.string().optional(),
    project_id: z.string().min(1),
    session_expires_at: z.number().int().positive().max(8_640_000_000_000),
    cookies: z
      .array(
        z.object({
          raw_cookie: z.string(),
          domain: z.object({ HostOnly: z.literal("compass.llm.shopee.io") }),
          path: z.tuple([z.literal("/"), z.boolean()]),
        }),
      )
      .min(1),
  }),
});

// AIS Switch 0.2.10 embeds this key beside its format descriptor. Read the installed
// app, not a copied key in our source or a decrypted credential file on disk.
async function readEncryptionKey(binaryPath: string): Promise<Buffer | null> {
  const file = await open(binaryPath, "r");
  try {
    const size = (await file.stat()).size;
    if (size > 256 * 1024 * 1024) return null;
    const chunk = Buffer.alloc(64 * 1024);
    let tail = Buffer.alloc(0);
    for (let position = 0; position < size; ) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      const data = Buffer.concat([tail, chunk.subarray(0, bytesRead)]);
      const index = data.indexOf(KEY_MARKER);
      if (index >= 0 && index + KEY_MARKER.length + 32 <= data.length) {
        return Buffer.from(
          data.subarray(index + KEY_MARKER.length, index + KEY_MARKER.length + 32),
        );
      }
      tail = Buffer.from(data.subarray(-KEY_MARKER.length - 32));
    }
    return null;
  } finally {
    await file.close();
  }
}

export async function readCredentials(input: Pick<AISUsageInput, "path" | "binaryPath">) {
  try {
    if ((await stat(input.path)).size > 1024 * 1024) return null;
    const data = await readFile(input.path);
    if (data.length < 36 || !data.subarray(0, 8).equals(HEADER)) return null;
    const key = await readEncryptionKey(input.binaryPath);
    if (!key) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(8, 20));
      decipher.setAAD(AAD);
      decipher.setAuthTag(data.subarray(-16));
      const plain = Buffer.concat([decipher.update(data.subarray(20, -16)), decipher.final()]);
      try {
        const parsed = credentialsSchema.safeParse(JSON.parse(plain.toString("utf8")));
        return parsed.success ? parsed.data : null;
      } finally {
        plain.fill(0);
      }
    } finally {
      key.fill(0);
    }
  } catch {
    return null;
  }
}
