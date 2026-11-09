import { OIDC_PROVIDER_ID, type OidcManagedProfile } from "@alloy/contracts"
import { authAccount } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import { and, eq } from "drizzle-orm"

import { usableOidcProvider } from "./oauth-config"
import { usernameFromHint } from "./username"

const UNMANAGED: OidcManagedProfile = { username: false, avatar: false }

export const OIDC_MANAGED_USERNAME_ERROR =
  "Your username is managed by your sign-in provider."
export const OIDC_MANAGED_AVATAR_ERROR =
  "Your avatar is managed by your sign-in provider."

/**
 * The profile fields a linked OIDC identity sets on every sign-in, which the
 * user therefore can't edit here. A field is managed while the provider is
 * usable and the last sign-in sent a usable claim for it, so turning SSO off
 * or a provider that sends no claim hands the field back to the user.
 */
export async function oidcManagedProfile(
  userId: string,
): Promise<OidcManagedProfile> {
  if (!usableOidcProvider()) return UNMANAGED
  const accounts = await db
    .select({
      accountLabel: authAccount.account_label,
      avatarUrl: authAccount.avatar_url,
    })
    .from(authAccount)
    .where(
      and(
        eq(authAccount.user_id, userId),
        eq(authAccount.provider_id, OIDC_PROVIDER_ID),
      ),
    )
  return {
    username: accounts.some(
      (account) => usernameFromHint(account.accountLabel) !== null,
    ),
    avatar: accounts.some((account) => account.avatarUrl !== null),
  }
}
