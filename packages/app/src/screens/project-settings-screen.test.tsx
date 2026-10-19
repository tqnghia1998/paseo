/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { HostRuntimeSnapshot } from "@/runtime/host-runtime";

const state = vi.hoisted(() => ({
  knownHost: true,
  snapshot: {
    connectionStatus: "online",
    agentDirectoryStatus: "initial_loading",
    hasEverLoadedAgentDirectory: false,
  } as HostRuntimeSnapshot,
}));
vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({ projects: [] }),
}));
vi.mock("@/runtime/host-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/runtime/host-runtime")>()),
  useHostRuntimeSnapshot: () => (state.knownHost ? state.snapshot : null),
  useHostRuntimeClient: () => null,
}));
vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => <span data-testid="project-loading" />,
}));
vi.mock("@/components/project-edit-sheet", () => ({ ProjectEditSheet: () => null }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: () => undefined }));
vi.mock("@/components/ui/text-input", () => ({ EditingTextInput: () => null }));
vi.mock("@/components/adaptive-modal-sheet", () => ({ AdaptiveModalSheet: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: () => null,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuTrigger: () => null,
}));

import ProjectSettingsScreen from "./project-settings-screen";

vi.stubGlobal("React", React);
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());
const onBackToProjects = vi.fn();

it("waits for the host project directory before declaring the current project uneditable", () => {
  state.snapshot.connectionStatus = "online";
  state.snapshot.agentDirectoryStatus = "initial_loading";
  state.snapshot.hasEverLoadedAgentDirectory = false;
  const view = render(
    <ProjectSettingsScreen
      serverId="local"
      projectId="current"
      onBackToProjects={onBackToProjects}
      showBackToProjects={false}
    />,
  );
  expect(screen.queryByText(i18n.t("settings.project.noEditableTarget"))).toBeNull();
  expect(screen.getByTestId("project-loading")).toBeTruthy();

  state.snapshot.agentDirectoryStatus = "ready";
  state.snapshot.hasEverLoadedAgentDirectory = true;
  view.rerender(
    <ProjectSettingsScreen
      serverId="local"
      projectId="current"
      onBackToProjects={onBackToProjects}
      showBackToProjects={false}
    />,
  );
  expect(screen.queryByTestId("project-loading")).toBeNull();
  expect(screen.getByText(i18n.t("settings.project.noEditableTarget"))).toBeTruthy();
});

it("waits during host reconnection but does not hide a confirmed offline host behind a spinner", () => {
  state.snapshot.connectionStatus = "connecting";
  state.snapshot.agentDirectoryStatus = "ready";
  state.snapshot.hasEverLoadedAgentDirectory = true;
  const props = {
    serverId: "local",
    projectId: "current",
    onBackToProjects,
    showBackToProjects: false,
  };
  const view = render(<ProjectSettingsScreen {...props} />);
  expect(screen.getByTestId("project-loading")).toBeTruthy();
  expect(screen.queryByText(i18n.t("settings.project.noEditableTarget"))).toBeNull();
  state.snapshot.connectionStatus = "offline";
  view.rerender(<ProjectSettingsScreen {...props} />);
  expect(screen.queryByTestId("project-loading")).toBeNull();
  expect(screen.queryByText(i18n.t("settings.project.noEditableTarget"))).toBeNull();
  expect(screen.getByText(i18n.t("agentPanel.states.reconnecting"))).toBeTruthy();
});

it("does not wait indefinitely for an unknown host", () => {
  state.knownHost = false;
  render(
    <ProjectSettingsScreen
      serverId="unknown"
      projectId="current"
      onBackToProjects={onBackToProjects}
      showBackToProjects={false}
    />,
  );
  expect(screen.queryByTestId("project-loading")).toBeNull();
  expect(screen.getByText(i18n.t("settings.project.noEditableTarget"))).toBeTruthy();
});
