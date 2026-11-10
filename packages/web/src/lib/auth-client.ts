import { createAuth } from "@alloy/api/auth"

export const authClient = createAuth({
  baseURL: window.location.origin,
  redirect: (url) => window.location.assign(url),
})

export const { useSession } = authClient
