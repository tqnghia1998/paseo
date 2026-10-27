import { createContext, useCallback, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_FORM_PREFERENCES,
  mergeProviderPreferences,
  type FormPreferences,
  type ProviderPreferences,
} from "@/create-agent-preferences/preferences";
import {
  createAgentPreferencesService,
  type CreateAgentPreferencesService,
  type FormPreferenceUpdate,
} from "@/create-agent-preferences/service";

const FORM_PREFERENCES_QUERY_KEY = ["form-preferences"];

interface FormPreferencesScope {
  id: string;
  service: CreateAgentPreferencesService;
}

export const FormPreferencesScopeContext = createContext<FormPreferencesScope | null>(null);

export type { FormPreferences, ProviderPreferences };

export { mergeProviderPreferences };

export interface UseFormPreferencesReturn {
  preferences: FormPreferences;
  isLoading: boolean;
  updatePreferences: (updates: FormPreferenceUpdate) => Promise<FormPreferences>;
}

export function useFormPreferences(): UseFormPreferencesReturn {
  const queryClient = useQueryClient();
  const scope = useContext(FormPreferencesScopeContext);
  const service = scope?.service ?? createAgentPreferencesService;
  const scopeId = scope?.id;
  const queryKey = useMemo(
    () => (scopeId ? [...FORM_PREFERENCES_QUERY_KEY, scopeId] : FORM_PREFERENCES_QUERY_KEY),
    [scopeId],
  );
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () => service.load(),
    staleTime: Infinity,
    gcTime: scope ? 0 : Infinity,
  });

  const preferences = data ?? DEFAULT_FORM_PREFERENCES;

  const updatePreferences = useCallback(
    async (updates: FormPreferenceUpdate) => {
      const next = await service.update(updates);
      queryClient.setQueryData<FormPreferences>(queryKey, next);
      return next;
    },
    [queryClient, service, queryKey],
  );

  return {
    preferences,
    isLoading: isPending,
    updatePreferences,
  };
}
