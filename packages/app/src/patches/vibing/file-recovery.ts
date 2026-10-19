import { z } from "zod";
import { FileVersionSchema } from "@getpaseo/protocol/messages";
import type { FileEditorRecovery } from "@/file-pane/editor/model";
import type { PanelInstanceIdentity } from "@/panels/panel-instance-attributes";
import { isEmbeddedFocusMode } from "./focus-mode";

const DraftSchema = z.object({
  file: z.object({ content: z.string(), hasBom: z.boolean(), version: FileVersionSchema }),
  content: z.string(),
});

// sessionStorage belongs to this host window and runtime origin and survives iframe eviction.
export function createEmbeddedFileRecovery(
  identity: PanelInstanceIdentity & { cwd: string; path: string },
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): FileEditorRecovery | undefined {
  if (!isEmbeddedFocusMode || typeof window === "undefined") return undefined;
  const key = `vibing:file-draft:${JSON.stringify(identity)}`;
  const getStorage = () => storage ?? window.sessionStorage;
  return {
    read() {
      const value = getStorage().getItem(key);
      if (!value) return null;
      const draft = DraftSchema.parse(JSON.parse(value));
      if (
        draft.file.version.status !== "ready" ||
        draft.file.version.cwd !== identity.cwd ||
        draft.file.version.path !== identity.path
      ) {
        throw new Error("Cannot recover this file draft: its original file identity is invalid.");
      }
      return { ...draft, file: { ...draft.file, version: draft.file.version } };
    },
    write(draft) {
      try {
        if (draft) getStorage().setItem(key, JSON.stringify(draft));
        else getStorage().removeItem(key);
      } catch {
        throw new Error(
          "Cannot preserve the file draft in this window. The edit or discard was not accepted. Free browser storage and retry.",
        );
      }
    },
  };
}
