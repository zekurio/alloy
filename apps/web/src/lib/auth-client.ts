import { createAuth } from "@workspace/api/auth"

import { apiOrigin } from "./env"

export const authClient = createAuth({
  baseURL: apiOrigin(),
  redirect: (url) => window.location.assign(url),
})

export const { useSession, signIn, signUp, signOut, getSession } = authClient
