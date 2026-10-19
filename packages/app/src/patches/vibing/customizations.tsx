import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings";
import { useHostFeature } from "@/runtime/host-features";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";
import { isEmbeddedFocusMode } from "./focus-mode";
import type { PluginPageState } from "@/screens/settings/plugins-page-state";

interface VibingPluginsSectionProps {
  serverId: string;
  supported: boolean;
  pageState: PluginPageState;
  children: ReactNode;
}

export function VibingPluginsSection({
  serverId,
  supported,
  pageState,
  children,
}: VibingPluginsSectionProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const plugin = useInstalledPlugin(serverId, "space-app-vibing-theme");
  const settingsSupported = useHostFeature(serverId, "pluginSettings");
  const catalogAvailable =
    settingsSupported && plugin?.settingsScreens.some((screen) => screen.id === "customizations");
  const openCatalog = useCallback(
    () =>
      router.push(buildPluginSettingsRoute(serverId, "space-app-vibing-theme", "customizations")),
    [router, serverId],
  );
  if (!isEmbeddedFocusMode) return null;
  const inventoryReady = supported && (pageState === "ready" || pageState === "empty");
  return (
    <SettingsSection
      title={t("settings.plugins.vibingTitle")}
      info={t("settings.plugins.vibingHint")}
      testID="vibing-plugin-section"
    >
      {inventoryReady ? children : null}
      <Button variant="outline" size="sm" onPress={openCatalog} disabled={!catalogAvailable}>
        {t("settings.plugins.vibingCatalog")}
      </Button>
    </SettingsSection>
  );
}
