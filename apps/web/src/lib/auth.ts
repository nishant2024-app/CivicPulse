"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { hasPermission, type Me, type Permission } from "@civicpulse/shared";
import { api, ApiError } from "./api";

export const ME_KEY = ["me"] as const;

/** Current user, or null when signed out. */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<Me>("/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });
}

/**
 * Call after anything that changes who the user is to the server (active organization,
 * role, memberships). Updates the identity first, then discards and refetches every
 * other query, because all of it was fetched for the previous organization.
 */
export async function refreshSession(queryClient: QueryClient, me?: Me): Promise<void> {
  if (me) queryClient.setQueryData(ME_KEY, me);
  else await queryClient.invalidateQueries({ queryKey: ME_KEY });
  await queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
}

export function can(me: Me | null | undefined, permission: Permission): boolean {
  return hasPermission(me?.role, permission);
}

export function activeMembership(me: Me | null | undefined) {
  return me?.memberships.find((m) => m.organizationId === me.activeOrganizationId) ?? null;
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: () => {
      queryClient.clear();
      // Full navigation so no cached authenticated UI survives.
      window.location.assign("/login");
    },
  });
}

export function useSwitchOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) =>
      api.post<Me>("/auth/switch-organization", { organizationId }),
    onSuccess: (me) => refreshSession(queryClient, me),
  });
}
