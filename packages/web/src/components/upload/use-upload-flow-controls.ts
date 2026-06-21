import { useContext } from "react"

import {
  UploadFlowContext,
  type UploadFlowControls,
} from "./upload-flow-context"

export function useUploadFlowControls(): UploadFlowControls {
  const value = useContext(UploadFlowContext)
  if (!value) {
    throw new Error(
      "useUploadFlowControls must be used within UploadFlowProvider",
    )
  }
  return value
}
