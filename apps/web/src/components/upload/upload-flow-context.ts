import * as React from "react"

export interface UploadFlowControls {
  queueOpen: boolean
  setQueueOpen: React.Dispatch<React.SetStateAction<boolean>>
  activeCount: number
  setActiveCount: React.Dispatch<React.SetStateAction<number>>
}

export const UploadFlowContext = React.createContext<UploadFlowControls | null>(
  null
)
