import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
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
  const { isPending, mutate, variables } = useMutation({
    mutationFn: (user: AdminUserRow) => api.admin.deleteUser(user.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
      toast.success(t("User removed"))
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't remove user"))),
  })
  const onDelete = useCallback((user: AdminUserRow) => mutate(user), [mutate])

  return {
    busyId: isPending ? (variables?.id ?? null) : null,
    onDelete,
  }
}

function useToggleAdminUserStatus() {
  const queryClient = useQueryClient()
  const { isPending, mutate, variables } = useMutation({
    mutationFn: (user: AdminUserRow) =>
      api.admin.updateUser(user.id, {
        status: user.status === "disabled" ? "active" : "disabled",
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
      toast.success(
        updated.status === "disabled" ? t("User disabled") : t("User enabled"),
      )
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't update user"))),
  })
  const onToggleStatus = useCallback(
    (user: AdminUserRow) => mutate(user),
    [mutate],
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
        ...(roleChanged ? { role: next.role } : {}),
        ...(quotaChanged ? { storageQuotaBytes: next.storageQuotaBytes } : {}),
      })
    },
    onSuccess: async (updated, { user, next }) => {
      const quotaChanged = user.storageQuotaBytes !== next.storageQuotaBytes
      void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
      if (updated.id === currentUserId && quotaChanged) {
        await queryClient.invalidateQueries({ queryKey: userKeys.storage() })
      }
      toast.success(t("User updated"))
    },
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't update user"))),
  })
  const onUpdate = useCallback(
    (user: AdminUserRow, next: AdminUserEditableFields): Promise<boolean> => {
      const current = adminUserEditableFields(user)
      const roleChanged = current.role !== next.role
      const quotaChanged = current.storageQuotaBytes !== next.storageQuotaBytes
      if (!roleChanged && !quotaChanged) return Promise.resolve(true)

      if (user.id === currentUserId && roleChanged && next.role !== "admin") {
        toast.error(
          t(
            "Demote yourself from the profile page after promoting another admin first.",
          ),
        )
        return Promise.resolve(false)
      }

      return mutateAsync({ user, next }).then(
        () => true,
        () => false,
      )
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
