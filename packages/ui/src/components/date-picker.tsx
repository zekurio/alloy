"use client"

import { t, getRuntimeLocale, localeToLanguageTag } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { fieldControlClassName } from "@alloy/ui/lib/field-control"
import { cn } from "@alloy/ui/lib/utils"
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useMemo, useState } from "react"
import type { ComponentProps } from "react"

type DateParts = {
  year: number
  month: number
  day: number
}

type DatePickerProps = Omit<
  ComponentProps<"button">,
  "children" | "onChange" | "value"
> & {
  id?: string
  value: string
  onValueChange: (value: string) => void
  className?: string
}

type LocaleWithWeekInfo = Intl.Locale & {
  weekInfo?: {
    firstDay?: number
  }
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0")
}

function serializeDateParts(parts: DateParts): string {
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`
}

function datePartsFromDate(date: Date): DateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }
}

function dateFromParts(parts: DateParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day)
}

function parseDateValue(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

function monthStart(parts: DateParts): Date {
  return new Date(parts.year, parts.month - 1, 1)
}

function monthStartForValue(value: string): Date {
  return monthStart(parseDateValue(value) ?? datePartsFromDate(new Date()))
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function sameDate(a: DateParts | null, b: DateParts): boolean {
  return a?.year === b.year && a.month === b.month && a.day === b.day
}

function getFirstDayOfWeek(languageTag: string): number {
  const locale = new Intl.Locale(languageTag) as LocaleWithWeekInfo
  const firstDay = locale.weekInfo?.firstDay ?? 1
  return firstDay === 7 ? 0 : firstDay
}

function getWeekdayDate(day: number): Date {
  return new Date(2021, 7, 1 + day)
}

function DatePicker({
  id,
  value,
  onValueChange,
  className,
  disabled,
  ...props
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() =>
    monthStartForValue(value),
  )

  const languageTag = localeToLanguageTag(getRuntimeLocale())
  const selectedDate = parseDateValue(value)
  const today = datePartsFromDate(new Date())

  const formatters = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(languageTag, {
        day: "numeric",
      }),
      fullDate: new Intl.DateTimeFormat(languageTag, {
        day: "numeric",
        month: "long",
        weekday: "long",
        year: "numeric",
      }),
      trigger: new Intl.DateTimeFormat(languageTag, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      month: new Intl.DateTimeFormat(languageTag, {
        month: "long",
        year: "numeric",
      }),
      weekday: new Intl.DateTimeFormat(languageTag, {
        weekday: "short",
      }),
    }),
    [languageTag],
  )

  const firstDayOfWeek = useMemo(
    () => getFirstDayOfWeek(languageTag),
    [languageTag],
  )

  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const weekday = (firstDayOfWeek + index) % 7
        return formatters.weekday.format(getWeekdayDate(weekday))
      }),
    [firstDayOfWeek, formatters],
  )

  const calendarDays = useMemo(() => {
    const year = visibleMonth.getFullYear()
    const month = visibleMonth.getMonth()
    const startOffset =
      (new Date(year, month, 1).getDay() - firstDayOfWeek + 7) % 7
    const gridStart = new Date(year, month, 1 - startOffset)

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index,
      )

      return {
        date,
        parts: datePartsFromDate(date),
        currentMonth: date.getMonth() === month,
      }
    })
  }, [firstDayOfWeek, visibleMonth])

  const triggerLabel = selectedDate
    ? formatters.trigger.format(dateFromParts(selectedDate))
    : t("Choose date")

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) setVisibleMonth(monthStartForValue(value))
  }

  function handleSelect(parts: DateParts) {
    onValueChange(serializeDateParts(parts))
    setOpen(false)
  }

  function handleToday() {
    setVisibleMonth(monthStart(today))
    onValueChange(serializeDateParts(today))
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            id={id}
            type="button"
            className={cn(
              fieldControlClassName,
              "flex h-9 w-full items-center justify-between gap-2 px-3",
              "text-base whitespace-nowrap select-none sm:h-8 sm:text-sm",
              "disabled:pointer-events-none",
              "[&_svg]:pointer-events-none [&_svg]:shrink-0",
              "[&_svg:not([class*='size-'])]:size-4",
              className,
            )}
            {...props}
          />
        }
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left leading-4",
            !selectedDate && "text-muted-foreground",
          )}
        >
          {triggerLabel}
        </span>
        <CalendarIcon className="text-muted-foreground size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Previous month")}
            onClick={() => setVisibleMonth((month) => addMonths(month, -1))}
          >
            <ChevronLeftIcon />
          </Button>
          <div className="text-sm font-medium capitalize">
            {formatters.month.format(visibleMonth)}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Next month")}
            onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
          >
            <ChevronRightIcon />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {weekdayLabels.map((weekday) => (
            <div
              key={weekday}
              className="text-muted-foreground flex h-7 items-center justify-center text-xs font-medium"
            >
              {weekday}
            </div>
          ))}
          {calendarDays.map(({ date, parts, currentMonth }) => {
            const dateValue = serializeDateParts(parts)
            const selected = sameDate(selectedDate, parts)
            const isToday = sameDate(today, parts)

            return (
              <button
                key={dateValue}
                type="button"
                aria-current={isToday ? "date" : undefined}
                aria-pressed={selected}
                aria-label={formatters.fullDate.format(date)}
                onClick={() => handleSelect(parts)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md",
                  "text-sm leading-none outline-none select-none",
                  "transition-[background-color,color,box-shadow]",
                  "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                  "focus-visible:ring-2 focus-visible:ring-accent-border/30",
                  !currentMonth && "text-muted-foreground",
                  currentMonth && !selected && "text-foreground",
                  isToday && !selected && "ring-1 ring-accent-border",
                  selected
                    ? "bg-accent text-accent-foreground hover:bg-accent-hover"
                    : "hover:bg-accent/15 focus-visible:bg-accent/15",
                )}
              >
                {formatters.day.format(date)}
              </button>
            )
          })}
        </div>

        <div className="border-border flex items-center justify-between border-t pt-2">
          {selectedDate ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onValueChange("")}
            >
              {t("Clear date")}
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="accent-outline"
            size="sm"
            onClick={handleToday}
          >
            {t("Today")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
export type { DatePickerProps }
