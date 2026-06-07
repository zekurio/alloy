import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "alloy-ui/lib/utils"
import * as React from "react"

export function createSidebarGroupButtonComponent(
  state: {
    sidebar: string
    slot: string
  },
  defaultClassName: string,
) {
  return function SidebarGroupButtonComponent({
    className,
    render,
    ...props
  }: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
    return useRender({
      defaultTagName: "button",
      props: mergeProps<"button">(
        {
          className: cn(defaultClassName, className),
        },
        props,
      ),
      render,
      state,
    })
  }
}
