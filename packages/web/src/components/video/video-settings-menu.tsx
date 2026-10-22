import { getClientLocale, localeToLanguageTag, t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@alloy/ui/components/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { cn } from "@alloy/ui/lib/utils"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GaugeIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { useState } from "react"
import type { ComponentProps, ReactNode, RefObject } from "react"

import {
  mobileDrawerContentClass,
  MobileDrawerHandle,
} from "@/components/app/mobile-drawer-surface"

import type { QualityOption } from "./video-player-types"

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

type SettingsView = "main" | "quality" | "speed"

type SettingsChoice = {
  id: string
  label: string
  detail?: string
}

export type VideoSettingsMenuProps = {
  sheet: boolean
  sheetContainer: HTMLDivElement | null
  popoverContainer: RefObject<HTMLDivElement | null>
  triggerClassName: string
  glyphClassName: string
  qualityOptions: QualityOption[] | undefined
  selectedQualityId: string | undefined
  onSelectQuality: ((qualityId: string) => void) | undefined
  playbackRate: number
  onPlaybackRateChange: (rate: number) => void
}

function playbackRateLabel(rate: number): string {
  if (rate === 1) return t("Normal")
  const value = new Intl.NumberFormat(localeToLanguageTag(getClientLocale()), {
    maximumFractionDigits: 2,
  }).format(rate)
  return `${value}×`
}

function useSettingsModel({
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
  playbackRate,
  onPlaybackRateChange,
}: VideoSettingsMenuProps) {
  const [view, setView] = useState<SettingsView>("main")
  const showQuality = Boolean(
    qualityOptions && qualityOptions.length > 1 && onSelectQuality,
  )
  const selectedQuality = qualityOptions?.find(
    (option) => option.id === selectedQualityId,
  )
  const speedChoices: SettingsChoice[] = PLAYBACK_RATES.map((rate) => ({
    id: String(rate),
    label: playbackRateLabel(rate),
  }))

  const sub =
    view === "quality" && showQuality
      ? {
          title: t("Quality"),
          choices: qualityOptions ?? [],
          selectedId: selectedQualityId,
          onSelect: (id: string) => onSelectQuality?.(id),
        }
      : view === "speed"
        ? {
            title: t("Playback speed"),
            choices: speedChoices,
            selectedId: String(playbackRate),
            onSelect: (id: string) => onPlaybackRateChange(Number(id)),
          }
        : null

  const rows = [
    ...(showQuality
      ? [
          {
            view: "quality" as const,
            icon: <SlidersHorizontalIcon />,
            label: t("Quality"),
            value: selectedQuality?.label ?? "",
          },
        ]
      : []),
    {
      view: "speed" as const,
      icon: <GaugeIcon />,
      label: t("Playback speed"),
      value: playbackRateLabel(playbackRate),
    },
  ]

  return { setView, sub, rows }
}

export function VideoSettingsMenu(props: VideoSettingsMenuProps) {
  const { setView, sub, rows } = useSettingsModel(props)
  const { sheet, sheetContainer, popoverContainer } = props
  const trigger = (
    <SettingsButton
      className={props.triggerClassName}
      glyphClassName={props.glyphClassName}
    />
  )
  // Every opening starts on the overview; resetting on close would swap the
  // panel while its exit animation is still running.
  const onOpenChange = (open: boolean) => {
    if (open) setView("main")
  }

  if (sheet) {
    return (
      <Drawer direction="bottom" onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent
          container={sheetContainer}
          className={mobileDrawerContentClass}
        >
          <MobileDrawerHandle />
          {sub ? (
            <div className="flex items-center gap-1 px-2 pt-1 pb-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("Back")}
                className="size-11"
                onClick={() => setView("main")}
              >
                <ChevronLeftIcon />
              </Button>
              <DrawerTitle className="text-base">{sub.title}</DrawerTitle>
            </div>
          ) : (
            <DrawerTitle className="px-4 pt-3 pb-2 text-base">
              {t("Settings")}
            </DrawerTitle>
          )}
          <div className="min-h-0 overflow-y-auto px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {sub ? (
              <div role="radiogroup" aria-label={sub.title}>
                {sub.choices.map((choice) => (
                  <DrawerClose key={choice.id} asChild>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={choice.id === sub.selectedId}
                      className={sheetRowClass}
                      onClick={() => sub.onSelect(choice.id)}
                    >
                      <span>{choice.label}</span>
                      {choice.detail ? (
                        <span className="text-foreground-dim ml-auto pl-3 text-xs">
                          {choice.detail}
                        </span>
                      ) : null}
                      {choice.id === sub.selectedId ? (
                        <CheckIcon
                          className={cn(
                            "text-accent size-4 shrink-0",
                            choice.detail ? "ml-3" : "ml-auto",
                          )}
                        />
                      ) : null}
                    </button>
                  </DrawerClose>
                ))}
              </div>
            ) : (
              rows.map((row) => (
                <button
                  key={row.view}
                  type="button"
                  className={cn(
                    sheetRowClass,
                    "[&>svg]:text-foreground-dim gap-3 [&>svg]:size-[18px] [&>svg]:shrink-0",
                  )}
                  onClick={() => setView(row.view)}
                >
                  {row.icon}
                  <span className="min-w-0 truncate">{row.label}</span>
                  <SettingsRowValue value={row.value} />
                  <ChevronRightIcon />
                </button>
              ))
            )}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        portalContainer={popoverContainer}
        // Size to the longest label (e.g. German "Wiedergabegeschwindigkeit")
        // instead of pushing the value and chevron out of a fixed width.
        className="w-max max-w-(--available-width) min-w-64 max-md:min-w-64"
      >
        {sub ? (
          <>
            <DropdownMenuItem
              closeOnClick={false}
              aria-label={t("Back")}
              className="text-foreground font-medium"
              onClick={() => setView("main")}
            >
              <ChevronLeftIcon />
              {sub.title}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={sub.selectedId}
              onValueChange={sub.onSelect}
            >
              {sub.choices.map((choice) => (
                <DropdownMenuRadioItem
                  key={choice.id}
                  value={choice.id}
                  closeOnClick
                >
                  {choice.label}
                  {choice.detail ? (
                    <span className="text-foreground-dim ml-auto pl-3 text-xs">
                      {choice.detail}
                    </span>
                  ) : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : (
          rows.map((row) => (
            <DropdownMenuItem
              key={row.view}
              closeOnClick={false}
              onClick={() => setView(row.view)}
            >
              {row.icon}
              <span className="text-foreground min-w-0 truncate">
                {row.label}
              </span>
              <SettingsRowValue value={row.value} />
              <ChevronRightIcon className="-mr-1" />
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const sheetRowClass =
  "hover:bg-surface-raised focus-visible:ring-ring flex min-h-12 w-full items-center rounded-lg px-3 text-left text-sm outline-none focus-visible:ring-2"

function SettingsRowValue({ value }: { value: ReactNode }) {
  return (
    <span className="text-foreground-dim ml-auto min-w-0 truncate pl-3 text-xs">
      {value}
    </span>
  )
}

function SettingsButton({
  className,
  glyphClassName,
  ...props
}: { glyphClassName: string } & Omit<ComponentProps<typeof Button>, "size">) {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("Settings")}
      className={className}
    >
      <SettingsIcon className={glyphClassName} />
    </Button>
  )
}
