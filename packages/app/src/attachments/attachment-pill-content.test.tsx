import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { getAgentAttachmentPillContent } from "./attachment-pill-content";
import { buildEmbeddedLiveDesignAttachment } from "@/embedded-live-design";

describe("agent attachment pill content", () => {
  it("presents Live Design evidence as a text attachment label", () => {
    const { attachment } = buildEmbeddedLiveDesignAttachment([{ comment: "Tighten spacing" }]);
    const content = getAgentAttachmentPillContent(attachment, i18n.t);
    expect(content.title).toBe("Live Design context");
    expect(content.subtitle).toBe(i18n.t("message.attachments.text"));
    expect(content.title).not.toContain("Tighten spacing");
  });
  it("presents external resources with their provider identity", () => {
    const content = getAgentAttachmentPillContent(
      {
        type: "text",
        mimeType: "text/plain",
        title: "ENG-123 Plugin attachments",
        text: "Linear issue ENG-123: Plugin attachments",
        externalResource: {
          provider: "linear",
          providerLabel: "Linear issue",
          resourceType: "issue",
          id: "issue-uuid",
          identifier: "ENG-123",
          title: "Plugin attachments",
          url: "https://linear.app/acme/issue/ENG-123/plugin-attachments",
        },
      },
      i18n.t,
    );

    expect(content.title).toBe("Plugin attachments");
    expect(content.subtitle).toBe("Linear issue ENG-123");
  });
});
