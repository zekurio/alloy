import { t } from "@alloy/i18n"
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback } from "react"

import { adminKeys, adminUsersQueryOptions } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { userKeys } from "@/lib/user-queries"

import {
  adminUserFieldChanges,
  adminUserIsBanned,
  type AdminUserEditableFields,
  type AdminUserRow,
} from "./admin-user-data"

type UpdateAdminUserVariables = {
  user: AdminUserRow
  changes: Partial<AdminUserEditableFields>
}

function useAdminUsersQuery(search: string) {
  const usersQuery = useInfiniteQuery(adminUsersQueryOptions(search))

  return {
    users: usersQuery.data
      ? usersQuery.data.pages.flatMap((page) => page.users)
      : null,
    total: usersQuery.data?.pages[0]?.total ?? 0,
    // Loaded rows win over an error, so a failed refetch or "Load more" keeps
    // the list on screen.
    loadError:
      usersQuery.error && !usersQuery.data
        ? errorMessage(usersQuery.error, t("Failed to load users"))
        : null,
    hasNextPage: usersQuery.hasNextPage,
    isFetchingNextPage: usersQuery.isFetchingNextPage,
    fetchNextPage: usersQuery.fetchNextPage,
  }
}

/**
 * A mutation on one user row. It refreshes the user list on success and
 * reports the row it is working on, so that row's menu stays disabled.
 */
function useAdminUserRowMutation<TVariables, TResult>({
  rowId,
  mutationFn,
  onSuccess,
}: {
  rowId: (variables: TVariables) => string
  mutationFn: (variables: TVariables) => Promise<TResult>
  onSuccess?: (variables: TVariables) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const { isPending, mutateAsync, variables } = useMutation({
    mutationFn,
    onSuccess: async (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
      await onSuccess?.(variables)
    },
  })
  const run = useCallback(
    async (variables: TVariables) => {
      await mutateAsync(variables)
    },
    [mutateAsync],
  )

  return {
    busyId: isPending && variables !== undefined ? rowId(variables) : null,
    run,
  }
}

function useAdminUserMutations(currentUserId: string) {
  const queryClient = useQueryClient()
  const remove = useAdminUserRowMutation({
    rowId: (user: AdminUserRow) => user.id,
    mutationFn: (user) => api.admin.deleteUser(user.id),
  })
  const toggleStatus = useAdminUserRowMutation({
    rowId: (user: AdminUserRow) => user.id,
    mutationFn: (user) =>
      api.admin.updateUser(user.id, {
        status: adminUserIsBanned(user) ? "active" : "disabled",
      }),
  })
  const update = useAdminUserRowMutation({
    rowId: ({ user }: UpdateAdminUserVariables) => user.id,
    mutationFn: ({ user, changes }) => api.admin.updateUser(user.id, changes),
    onSuccess: async ({ user, changes }) => {
      if (user.id === currentUserId && "storageQuotaBytes" in changes) {
        await queryClient.invalidateQueries({ queryKey: userKeys.storage() })
      }
    },
  })

  const runUpdate = update.run
  const onUpdate = useCallback(
    (user: AdminUserRow, next: AdminUserEditableFields): Promise<void> => {
      const changes = adminUserFieldChanges(user, next)
      if (!changes) return Promise.resolve()

      if (user.id === currentUserId && changes.role === "user") {
        return Promise.reject(
          new Error(
            t(
              "Demote yourself from the profile page after promoting another admin first.",
            ),
          ),
        )
      }

      return runUpdate({ user, changes })
    },
    [currentUserId, runUpdate],
  )

  return {
    busyId: remove.busyId ?? toggleStatus.busyId ?? update.busyId,
    onDelete: remove.run,
    onToggleStatus: toggleStatus.run,
    onUpdate,
  }
}

export function useAdminUsers(currentUserId: string, search: string) {
  return {
    ...useAdminUsersQuery(search),
    ...useAdminUserMutations(currentUserId),
  }
}
