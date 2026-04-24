import * as React from "react"

import { UploadFlowContext } from "./upload-flow-context"

export function UploadFlowProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [queueOpen, setQueueOpen] = React.useState(false)
  const [activeCount, setActiveCount] = React.useState(0)

  const value = React.useMemo(
    () => ({ queueOpen, setQueueOpen, activeCount, setActiveCount }),
    [queueOpen, activeCount]
  )

  return (
    <UploadFlowContext.Provider value={value}>
      {children}
    </UploadFlowContext.Provider>
  )
}
