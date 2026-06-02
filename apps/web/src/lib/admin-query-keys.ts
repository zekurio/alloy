import { queryOptions } from "@tanstack/react-query"

import { api } from "@/lib/api"

export const adminKeys = {
  all: ["admin"] as const,
  encoderCapabilities: () =>
    [...adminKeys.all, "encoder-capabilities"] as const,
  runtimeConfig: () => [...adminKeys.all, "runtime-config"] as const,
  users: () => [...adminKeys.all, "users"] as const,
}

export function adminRuntimeConfigQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.runtimeConfig(),
    queryFn: () => api.admin.fetchRuntimeConfig(),
  })
}

export function adminEncoderCapabilitiesQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.encoderCapabilities(),
    queryFn: () => api.admin.fetchEncoderCapabilities(),
    staleTime: 5 * 60_000,
  })
}

export function adminUsersQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.users(),
    queryFn: () => api.admin.fetchUsers(),
  })
}
