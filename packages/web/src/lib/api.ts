import { createApi } from "alloy-api"

import { apiOrigin, publicOrigin } from "./env"

export const api = createApi({
  baseURL: apiOrigin(),
  publicURL: publicOrigin(),
})
