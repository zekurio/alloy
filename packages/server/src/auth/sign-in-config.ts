import { OIDC_PROVIDER_ID } from "@alloy/contracts"
import { authAccount, user, userPasskey } from "@alloy/db/auth-schema"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { and, eq, ne } from "drizzle-orm"

import { usableOidcProvider } from "./oauth-config"

export type SignInMethodConfig = {
  passkeyEnabled: boolean
  /** The OIDC provider is enabled and has a client secret. */
  oidcUsable: boolean
}

type AuthDbExecutor = typeof db | DbTransaction

export function currentSignInConfig(): SignInMethodConfig {
  return {
    passkeyEnabled: configStore.get("passkeyEnabled"),
    oidcUsable: usableOidcProvider() !== null,
  }
}

export async function hasAdminSignInMethodForConfig(
  config: SignInMethodConfig,
): Promise<boolean> {
  return hasAdminSignInMethodWith(db, config)
}

export async function hasAdminSignInMethodWith(
  executor: AuthDbExecutor,
  config: SignInMethodConfig,
  options: { excludeUserId?: string } = {},
): Promise<boolean> {
  const conditions = [eq(user.role, "admin"), eq(user.status, "active")]
  if (options.excludeUserId) {
    conditions.push(ne(user.id, options.excludeUserId))
  }

  if (config.passkeyEnabled) {
    const passkeyRows = await executor
      .select({ id: user.id })
      .from(user)
      .innerJoin(userPasskey, eq(userPasskey.user_id, user.id))
      .where(and(...conditions))
      .limit(1)
    if (passkeyRows.length > 0) return true
  }

  if (!config.oidcUsable) return false

  const oauthRows = await executor
    .select({ id: user.id })
    .from(user)
    .innerJoin(authAccount, eq(authAccount.user_id, user.id))
    .where(and(...conditions, eq(authAccount.provider_id, OIDC_PROVIDER_ID)))
    .limit(1)
  return oauthRows.length > 0
}

export async function signInConfigError(
  config: SignInMethodConfig,
): Promise<string | null> {
  if (!config.passkeyEnabled && !config.oidcUsable) {
    return "Keep at least one sign-in method enabled."
  }
  if (!(await hasAdminSignInMethodForConfig(config))) {
    return "Keep at least one active admin sign-in method before disabling passkeys or single sign-on."
  }
  return null
}
