import { queryOptions } from "@tanstack/react-query"

import { api } from "@/lib/api"

export const adminKeys = {
  all: ["admin"] as const,
  runtimeConfig: () => [...adminKeys.all, "runtime-config"] as const,
  scheduledTasks: () => [...adminKeys.all, "scheduled-tasks"] as const,
  users: () => [...adminKeys.all, "users"] as const,
}

export function adminRuntimeConfigQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.runtimeConfig(),
    queryFn: () => api.admin.fetchRuntimeConfig(),
  })
}

export function adminUsersQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.users(),
    queryFn: () => api.admin.fetchUsers(),
  })
}

export function adminScheduledTasksQueryOptions() {
  return queryOptions({
    queryKey: adminKeys.scheduledTasks(),
    queryFn: () => api.admin.fetchScheduledTasks(),
  })
}
