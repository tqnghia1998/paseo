import { Text, View } from "react-native";
import {
  SettingsCard,
  SettingsCollapsibleRow,
  SettingsRow,
  SettingsSection,
} from "@/components/settings";
import { settingsStyles } from "@/styles/settings";

// This describes shipped source changes. Runtime plugin health belongs to Plugins.
const sections = [
  {
    title: "Plugin changes",
    entries: [
      {
        title: "Vibing theme",
        description:
          "Adds the Space App Vibing palette as a built-in plugin. A small embedding patch selects it once; later appearance choices are preserved.",
        source: "plugins/space-app-vibing-theme/ · packages/app/src/patches/vibing/theme.ts",
      },
      {
        title: "Codex Enterprise usage",
        description:
          "Extends Paseo’s existing Codex usage plugin with Enterprise spending allowances, reported units, remaining amounts and reset times.",
        source: "plugins/codex-usage-source/server/usage.ts",
      },
    ],
  },
  {
    title: "Workspace integration",
    entries: [
      {
        title: "Worktree navigation",
        description:
          "Keeps sidebar, History, search, imports and schedules within the current worktree. Vibing owns switching worktrees and closing workspaces.",
        source:
          "packages/app/src/patches/vibing/workspace-boundary.ts · navigation-boundary.tsx · sidebar.ts",
      },
      {
        title: "Prompt insertion",
        description:
          "Inserts prompts from Vibing into the active editable composer without sending them, finding or creating a conversation when needed.",
        source: "packages/app/src/patches/vibing/host-prompts.ts · workspace-conversation.ts",
      },
      {
        title: "Live Design requests",
        description:
          "Sends preview notes as text context, supports fresh agents, and reports correlated completion back to Vibing. Context survives drafts, queues and conversation rewind.",
        source: "packages/app/src/patches/vibing/live-design.ts · composer-bridge.ts",
      },
      {
        title: "Agent activity",
        description:
          "Reports running agents to Vibing’s workspace indicators, including workspaces whose Paseo iframe is not mounted.",
        source:
          "packages/app/src/patches/vibing/agent-activity.tsx · packages/server/src/patches/vibing/worktree-activity.ts",
      },
      {
        title: "Queued message recovery",
        description:
          "Checkpoints queued messages across iframe remounts. Queue is the default action while an agent is running.",
        source:
          "packages/app/src/patches/vibing/queued-messages.ts · packages/app/src/hooks/use-settings/migrations.ts",
      },
      {
        title: "Unsaved editor recovery",
        description:
          "Preserves unsaved file edits across iframe remounts in the same window, with conflict and storage-failure guards.",
        source: "packages/app/src/patches/vibing/file-recovery.ts",
      },
      {
        title: "Worktree resource cleanup",
        description:
          "Lets Vibing stop worktree agents, terminals and setup resources before offloading or deleting a workspace. Cleanup endpoints require the local host capability.",
        source: "packages/server/src/patches/vibing/worktree-runtime.ts",
      },
      {
        title: "Workspace identity recovery",
        description:
          "Reopens folders through Paseo’s project resolver and uses recent agent activity when recovering duplicate workspace records.",
        source:
          "packages/app/src/patches/vibing/folder-workspace.ts · packages/server/src/patches/vibing/workspace-open.ts",
      },
    ],
  },
  {
    title: "Provider and runtime changes",
    entries: [
      {
        title: "Codex questions",
        description:
          "Enables structured questions in Default and Plan modes. Session instructions require waiting for answers while preserving native developer instructions and explicit feature opt-outs.",
        source: "packages/server/src/patches/vibing/codex/questions.ts",
      },
      {
        title: "Interactive Codex shells",
        description:
          "Keeps interactive shell input and live output together in native Shell cards.",
        source: "packages/server/src/patches/vibing/codex/terminal-interactions.ts",
      },
      {
        title: "Compatibility and rendering fixes",
        description:
          "Includes archived Codex imports, Pi turn completion, readable unresolved citations, text-attachment transport and tooltip cleanup when retained tabs hide.",
        source: "docs/vibing-patches.md — Small edits that stay upstream",
      },
      {
        title: "Standalone embedding",
        description:
          "Bundles Paseo’s web UI, daemon, built-in plugins and runtime dependencies for Vibing. Enables embedded voice features and discovers the bundled plugin directory.",
        source: "scripts/bundle-paseo-web.mjs · scripts/paseo-web.js",
      },
    ],
  },
];

export function VibingCustomizationsSection() {
  return (
    <View testID="vibing-customizations">
      <Text style={[settingsStyles.rowHint, settingsStyles.section]}>
        Source changes included in this Vibing build. This catalog is read-only; runtime plugin
        status and additional-plugin controls are under Plugins. Other bundled provider and usage
        plugins come from upstream Paseo.
      </Text>
      {sections.map((section) => (
        <SettingsSection key={section.title} title={section.title}>
          <SettingsCard>
            {section.entries.map((entry) => (
              <SettingsRow key={entry.title} label={entry.title} hint={entry.description} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ))}
      <SettingsCard>
        <SettingsCollapsibleRow label="Implementation details">
          <SettingsRow label="Fork catalog" hint="Paseo checkout: docs/vibing-patches.md" />
          {sections
            .flatMap((section) => section.entries)
            .map((entry) => (
              <SettingsRow key={entry.title} label={entry.title} hint={entry.source} />
            ))}
        </SettingsCollapsibleRow>
      </SettingsCard>
    </View>
  );
}
