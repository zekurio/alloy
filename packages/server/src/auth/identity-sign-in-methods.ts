import { authAccount, user, userPasskey } from "@alloy/db/auth-schema"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { and, eq, sql } from "drizzle-orm"

import { withAdminAccessChange } from "./admin-access"
import { usableOidcProvider } from "./oauth-config"

type AuthExecutor = typeof db | DbTransaction

async function countEnabledOAuthAccounts(
  userId: string,
  excludeAccount?: { providerId: string; providerAccountId: string },
  executor: AuthExecutor = db,
): Promise<number> {
  const provider = usableOidcProvider()
  if (!provider) return 0

  const rows = await executor
    .select({
      providerAccountId: authAccount.provider_account_id,
      providerId: authAccount.provider_id,
    })
    .from(authAccount)
    .where(
      and(
        eq(authAccount.user_id, userId),
        eq(authAccount.provider_id, provider.providerId),
      ),
    )

  return rows.filter(
    (row) =>
      !excludeAccount ||
      row.providerId !== excludeAccount.providerId ||
      row.providerAccountId !== excludeAccount.providerAccountId,
  ).length
}

async function userHasEnabledSignInMethod(
  userId: string,
  options: {
    excludeAccount?: { providerId: string; providerAccountId: string }
    excludePasskeyId?: string
    executor?: AuthExecutor
  } = {},
): Promise<boolean> {
  const executor = options.executor ?? db
  if (configStore.get("passkeyEnabled")) {
    const passkeys = await executor
      .select({ id: userPasskey.id })
      .from(userPasskey)
      .where(eq(userPasskey.user_id, userId))
    if (passkeys.some((passkey) => passkey.id !== options.excludePasskeyId)) {
      return true
    }
  }

  return (
    (await countEnabledOAuthAccounts(
      userId,
      options.excludeAccount,
      executor,
    )) > 0
  )
}

async function lockUserSignInMethods(
  tx: DbTransaction,
  userId: string,
): Promise<void> {
  await tx.execute(sql`
    select ${user.id}
    from ${user}
    where ${user.id} = ${userId}
    for update
  `)
}

export async function deleteUserPasskeyPreservingSignIn(input: {
  userId: string
  passkeyId: string
}): Promise<"deleted" | "not-found" | "last-sign-in-method"> {
  return withAdminAccessChange(() =>
    db.transaction(async (tx) => {
      await lockUserSignInMethods(tx, input.userId)

      if (
        !(await userHasEnabledSignInMethod(input.userId, {
          excludePasskeyId: input.passkeyId,
          executor: tx,
        }))
      ) {
        return "last-sign-in-method"
      }

      const [deleted] = await tx
        .delete(userPasskey)
        .where(
          and(
            eq(userPasskey.id, input.passkeyId),
            eq(userPasskey.user_id, input.userId),
          ),
        )
        .returning({ id: userPasskey.id })

      return deleted ? "deleted" : "not-found"
    }),
  )
}

export async function unlinkOAuthAccountPreservingSignIn(input: {
  userId: string
  providerId: string
  providerAccountId: string
}): Promise<"deleted" | "not-found" | "last-sign-in-method"> {
  return withAdminAccessChange(() =>
    db.transaction(async (tx) => {
      await lockUserSignInMethods(tx, input.userId)

      if (
        !(await userHasEnabledSignInMethod(input.userId, {
          excludeAccount: {
            providerId: input.providerId,
            providerAccountId: input.providerAccountId,
          },
          executor: tx,
        }))
      ) {
        return "last-sign-in-method"
      }

      const [deleted] = await tx
        .delete(authAccount)
        .where(
          and(
            eq(authAccount.user_id, input.userId),
            eq(authAccount.provider_id, input.providerId),
            eq(authAccount.provider_account_id, input.providerAccountId),
          ),
        )
        .returning({ id: authAccount.id })

      return deleted ? "deleted" : "not-found"
    }),
  )
}
