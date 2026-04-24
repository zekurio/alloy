import * as React from "react"

import {
  UploadFlowContext,
  type UploadFlowControls,
} from "./upload-flow-context"

export function useUploadFlowControls(): UploadFlowControls {
  const value = React.useContext(UploadFlowContext)
  if (!value) {
    throw new Error(
      "useUploadFlowControls must be used within UploadFlowProvider"
    )
  }
  return value
}
