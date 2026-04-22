import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@workspace/ui/lib/utils"

export function createSidebarGroupDivComponent(
  state: {
    sidebar: string
    slot: string
  },
  defaultClassName: string,
) {
  return function SidebarGroupDivComponent({
    className,
    render,
    ...props
  }: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
    return useRender({
      defaultTagName: "div",
      props: mergeProps<"div">(
        {
          className: cn(defaultClassName, className),
        },
        props
      ),
      render,
      state,
    })
  }
}
