import type { SetupStatus } from "@alloy/contracts"

import type { ApiContext } from "./client"
import { validateSetupStatus } from "./contract-validators"
import { readJsonOrThrow } from "./http"

export type { SetupStatus } from "@alloy/contracts"

export function createSetupApi(context: ApiContext) {
  const setup = context.rpc.api.setup
  return {
    async fetchStatus(): Promise<SetupStatus> {
      const res = await setup.status.$get()
      return readJsonOrThrow(res, validateSetupStatus)
    },
    /** Present the setup token; this browser may then create the admin. */
    async verifyToken(token: string): Promise<SetupStatus> {
      const res = await setup.verify.$post({ json: { token } })
      return readJsonOrThrow(res, validateSetupStatus)
    },
  }
}
