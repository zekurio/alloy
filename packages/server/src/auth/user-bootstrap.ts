import { configStore } from "@alloy/server/config/store"

import { setupRequired } from "./identity"

export async function getSetupStatus(): Promise<{
  adminAccountRequired: boolean
  setupRequired: boolean
}> {
  const adminAccountRequired = await setupRequired()
  return {
    adminAccountRequired,
    setupRequired: adminAccountRequired || !configStore.get("setupComplete"),
  }
}
