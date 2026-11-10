import { createApi } from "@alloy/api"

export const api = createApi({
  baseURL: window.location.origin,
  publicURL: window.location.origin,
})
