import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ComposerAttachment } from "@/attachments/types";
import { userAttachmentsOnly } from "@/attachments/workspace-attachment-utils";
import { UserComposerAttachmentSchema } from "@/stores/draft-store/state";
import { z } from "zod";

const QUEUED_MESSAGE_STORAGE_PREFIX = "paseo-queued-messages:";

const QueueSchema = z.record(
  z.string(),
  z.array(
    z.strictObject({
      id: z.string(),
      text: z.string(),
      attachments: z.array(UserComposerAttachmentSchema),
    }),
  ),
);

export interface QueuedMessage {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
}
export interface QueuedMessageStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function storageKey(serverId: string): string {
  return `${QUEUED_MESSAGE_STORAGE_PREFIX}${encodeURIComponent(serverId)}`;
}

export function createQueuedMessagePersistence(storage: QueuedMessageStorage) {
  let write = Promise.resolve();

  return {
    async load(serverId: string): Promise<Map<string, QueuedMessage[]>> {
      const key = storageKey(serverId);
      try {
        const raw = await storage.getItem(key);
        if (!raw) return new Map();
        const result = QueueSchema.safeParse(JSON.parse(raw));
        if (!result.success) throw new Error("Invalid queued-message checkpoint");
        return new Map(Object.entries(result.data) as [string, QueuedMessage[]][]);
      } catch {
        await storage.removeItem(key).catch(() => undefined);
        return new Map();
      }
    },
    async save(serverId: string, queue: Map<string, QueuedMessage[]>): Promise<void> {
      const key = storageKey(serverId);
      write = write.then(async () => {
        try {
          if (queue.size === 0 || [...queue.values()].every((messages) => messages.length === 0)) {
            await storage.removeItem(key);
            return undefined;
          }
          await storage.setItem(
            key,
            JSON.stringify(
              Object.fromEntries(
                [...queue].map(([agentId, messages]) => [
                  agentId,
                  messages.map(({ id, text, attachments }) => ({
                    id,
                    text,
                    attachments: userAttachmentsOnly(attachments),
                  })),
                ]),
              ),
            ),
          );
        } catch {
          // The in-memory queue remains authoritative when durable storage is unavailable.
        }
        return undefined;
      });
      await write;
    },
  };
}

export const queuedMessagePersistence = createQueuedMessagePersistence(AsyncStorage);
