import { createAuth } from "@workspace/api/auth"

import { apiOrigin } from "./env"

export const authClient = createAuth(apiOrigin())

export const { useSession, signIn, signUp, signOut, getSession } = authClient
