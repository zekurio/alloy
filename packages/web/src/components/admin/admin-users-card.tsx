import { t, tp } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { Spinner } from "@alloy/ui/components/spinner"
import { SearchIcon, XIcon } from "lucide-react"
import { useState } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"

import { CreateUserDialog } from "./admin-user-dialogs"
import { useAdminUsers } from "./admin-user-hooks"
import { UsersList } from "./admin-user-list"

interface AdminUsersCardProps {
  currentUserId: string
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
}

export function AdminUsersCard({
  currentUserId,
  hideHeader,
}: AdminUsersCardProps) {
  const [search, setSearch] = useState("")
  const normalizedSearch = search.trim()
  const adminUsers = useAdminUsers(currentUserId, normalizedSearch)

  const list = adminUsers.loadError ? (
    <Callout tone="destructive">{adminUsers.loadError}</Callout>
  ) : adminUsers.users === null ? (
    <div className="text-foreground-muted grid place-items-center py-3">
      <Spinner className="size-4" />
    </div>
  ) : adminUsers.users.length === 0 ? (
    <ListEmpty
      title={normalizedSearch ? t("No users found") : t("No users yet")}
    />
  ) : (
    <>
      <UsersList
        users={adminUsers.users}
        currentUserId={currentUserId}
        busyId={adminUsers.busyId}
        onUpdate={adminUsers.onUpdate}
        onToggleStatus={adminUsers.onToggleStatus}
        onDelete={adminUsers.onDelete}
      />
      {adminUsers.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-center"
          disabled={adminUsers.isFetchingNextPage}
          onClick={() => adminUsers.fetchNextPage()}
        >
          {adminUsers.isFetchingNextPage ? t("Loading…") : t("Load more")}
        </Button>
      ) : null}
    </>
  )

  const content = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-foreground-muted text-sm tabular-nums">
          {tp(adminUsers.total, "user", "users")}
        </span>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <InputGroup className="w-full sm:max-w-xs">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Search users")}
              aria-label={t("Search users")}
            />
            {search ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("Clear search")}
                  onClick={() => setSearch("")}
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <CreateUserDialog />
        </div>
      </div>
      {list}
    </div>
  )

  if (hideHeader) return content

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{t("Users")}</SectionTitle>
      </SectionHeader>
      <SectionContent>{content}</SectionContent>
    </Section>
  )
}
