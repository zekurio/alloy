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
  adminUserEditableFields,
  type AdminUserEditableFields,
  type AdminUserRow,
} from "./admin-user-data"

type UpdateAdminUserVariables = {
  user: AdminUserRow
  next: AdminUserEditableFields
}

function useAdminUsersQuery(search: string) {
  const usersQuery = useInfiniteQuery(adminUsersQueryOptions(search))

  return {
    users: usersQuery.data
      ? usersQuery.data.pages.flatMap((page) => page.users)
      : null,
    total: usersQuery.data?.pages[0]?.total ?? 0,
    loadError: usersQuery.error
      ? errorMessage(usersQuery.error, t("Failed to load users"))
      : null,
    hasNextPage: usersQuery.hasNextPage,
    isFetchingNextPage: usersQuery.isFetchingNextPage,
    fetchNextPage: usersQuery.fetchNextPage,
  }
}

function useDeleteAdminUser() {
  const queryClient = useQueryClient()
  const { isPending, mutateAsync, variables } = useMutation({
    mutationFn: (user: AdminUserRow) => api.admin.deleteUser(user.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
    },
  })
  const onDelete = useCallback(
    (user: AdminUserRow) => mutateAsync(user).then(() => undefined),
    [mutateAsync],
  )

  return {
    busyId: isPending ? (variables?.id ?? null) : null,
    onDelete,
  }
}

function useToggleAdminUserStatus() {
  const queryClient = useQueryClient()
  const { isPending, mutateAsync, variables } = useMutation({
    mutationFn: (user: AdminUserRow) =>
      api.admin.updateUser(user.id, {
        status: user.status === "disabled" ? "active" : "disabled",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
    },
  })
  const onToggleStatus = useCallback(
    (user: AdminUserRow) => mutateAsync(user).then(() => undefined),
    [mutateAsync],
  )

  return {
    busyId: isPending ? (variables?.id ?? null) : null,
    onToggleStatus,
  }
}

function useUpdateAdminUser(currentUserId: string) {
  const queryClient = useQueryClient()
  const { isPending, mutateAsync, variables } = useMutation({
    mutationFn: ({ user, next }: UpdateAdminUserVariables) => {
      const current = adminUserEditableFields(user)
      const roleChanged = current.role !== next.role
      const quotaChanged = current.storageQuotaBytes !== next.storageQuotaBytes

      return api.admin.updateUser(user.id, {
        role: roleChanged ? next.role : undefined,
        storageQuotaBytes: quotaChanged ? next.storageQuotaBytes : undefined,
      })
    },
    onSuccess: async (updated, { user, next }) => {
      const quotaChanged = user.storageQuotaBytes !== next.storageQuotaBytes
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
      if (updated.id === currentUserId && quotaChanged) {
        await queryClient.invalidateQueries({ queryKey: userKeys.storage() })
      }
    },
  })
  const onUpdate = useCallback(
    (user: AdminUserRow, next: AdminUserEditableFields): Promise<void> => {
      const current = adminUserEditableFields(user)
      const roleChanged = current.role !== next.role
      const quotaChanged = current.storageQuotaBytes !== next.storageQuotaBytes
      if (!roleChanged && !quotaChanged) return Promise.resolve()

      if (user.id === currentUserId && roleChanged && next.role !== "admin") {
        return Promise.reject(
          new Error(
            t(
              "Demote yourself from the profile page after promoting another admin first.",
            ),
          ),
        )
      }

      return mutateAsync({ user, next }).then(() => undefined)
    },
    [currentUserId, mutateAsync],
  )

  return {
    busyId: isPending ? (variables?.user.id ?? null) : null,
    onUpdate,
  }
}

function useAdminUserMutations(currentUserId: string) {
  const deleteMutation = useDeleteAdminUser()
  const toggleStatusMutation = useToggleAdminUserStatus()
  const updateMutation = useUpdateAdminUser(currentUserId)

  return {
    busyId:
      deleteMutation.busyId ??
      toggleStatusMutation.busyId ??
      updateMutation.busyId,
    onDelete: deleteMutation.onDelete,
    onToggleStatus: toggleStatusMutation.onToggleStatus,
    onUpdate: updateMutation.onUpdate,
  }
}

export function useAdminUsers(currentUserId: string, search: string) {
  return {
    ...useAdminUsersQuery(search),
    ...useAdminUserMutations(currentUserId),
  }
}
