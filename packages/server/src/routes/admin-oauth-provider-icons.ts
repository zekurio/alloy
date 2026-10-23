import { OAUTH_PROVIDER_ICON_KEY_RE } from "@alloy/contracts"
import { assetStorage } from "@alloy/server/storage/index"

import { immutableImageAssetsRoute } from "./immutable-image-assets"

export const oauthProviderIconAssetsRoute = immutableImageAssetsRoute(
  assetStorage,
  OAUTH_PROVIDER_ICON_KEY_RE,
)
