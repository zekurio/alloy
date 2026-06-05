import { authAccount, user, userPasskey } from "@workspace/db/auth-schema"
import { and, eq, inArray, ne } from "drizzle-orm"

import { isOAuthProviderUsable } from "../config/secret-store"
import { db } from "../db"

export type SignInMethodConfig = {
  passkeyEnabled: boolean
  oauthProviders: { enabled: boolean; providerId: string }[]
}

type AuthTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type AuthDbExecutor = typeof db | AuthTransaction

export function usableSignInConfig(
  config: SignInMethodConfig,
  pendingSecret: (providerId: string) => boolean = () => false,
): SignInMethodConfig {
  return {
    passkeyEnabled: config.passkeyEnabled,
    oauthProviders: config.oauthProviders.filter((provider) =>
      isOAuthProviderUsable(provider, pendingSecret),
    ),
  }
}

export function hasEnabledSignInMethod(config: SignInMethodConfig): boolean {
  return (
    config.passkeyEnabled ||
    config.oauthProviders.some((provider) => provider.enabled)
  )
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
      .innerJoin(userPasskey, eq(userPasskey.userId, user.id))
      .where(and(...conditions))
      .limit(1)
    if (passkeyRows.length > 0) return true
  }

  const providerIds = config.oauthProviders
    .filter((provider) => provider.enabled)
    .map((provider) => provider.providerId)
  if (providerIds.length === 0) return false

  const oauthRows = await executor
    .select({ id: user.id })
    .from(user)
    .innerJoin(authAccount, eq(authAccount.userId, user.id))
    .where(and(...conditions, inArray(authAccount.providerId, providerIds)))
    .limit(1)
  return oauthRows.length > 0
}

export async function signInConfigError(
  config: SignInMethodConfig,
  pendingSecret: (providerId: string) => boolean = () => false,
): Promise<string | null> {
  // An OAuth provider only counts as a sign-in method if it's actually usable
  // (enabled AND has a secret, stored or about to be written). Filtering here
  // keeps lockout guards in sync with what the consumer layer will serve.
  const usable = usableSignInConfig(config, pendingSecret)
  if (!hasEnabledSignInMethod(usable)) {
    return "Keep at least one sign-in method enabled."
  }
  if (!(await hasAdminSignInMethodForConfig(usable))) {
    return "Keep at least one active admin sign-in method before disabling passkeys or OAuth."
  }
  return null
}
