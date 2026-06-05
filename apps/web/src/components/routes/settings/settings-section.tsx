import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { cn } from "@workspace/ui/lib/utils"
import { ChevronDownIcon, type LucideIcon } from "lucide-react"
import * as React from "react"

interface SettingsSectionProps {
  icon?: LucideIcon
  title: string
  description?: string
  children: React.ReactNode
  defaultOpen?: boolean
}

export function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  defaultOpen = false,
}: SettingsSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-border bg-surface overflow-hidden rounded-md border"
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer flex-col px-4 py-3 text-left transition-colors hover:bg-white/[0.02]">
        <div className="flex w-full items-center gap-3">
          {Icon && <Icon className="text-primary size-5 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{title}</div>
          </div>
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-foreground-dim transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </div>
        {description && (
          <p className="text-foreground-dim mt-1 text-xs">{description}</p>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-border border-t px-4 py-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
