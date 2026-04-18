import { createAuth } from "@workspace/api/auth"

import { env } from "./env"

// `VITE_API_URL` points the browser bundle at the API server. During local
// dev, the Hono app runs on 3000 and Vite on 5173 — see `./env` for the
// validated default.
export const authClient = createAuth(env.VITE_API_URL)

export const { useSession, signIn, signUp, signOut, getSession } = authClient
