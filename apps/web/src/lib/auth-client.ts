import { createAuth } from "@workspace/api/auth"

import { env } from "./env"

export const authClient = createAuth(env.VITE_API_URL)

export const { useSession, signIn, signUp, signOut, getSession } = authClient
