import { cn } from "@alloy/ui/lib/utils"
import { useEffect, useState } from "react"
import type { RefObject } from "react"

import {
  type SettingsSection,
  useSettingsSections,
} from "@/components/routes/settings/settings-sections-context"

/**
 * Child entries for the active sidebar category: one per subsection of the open
 * panel, highlighting whichever is currently in view.
 */
export function SettingsSectionNav({
  scrollRef,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const sections = useSettingsSections()
  const activeId = useSectionInView(scrollRef, sections)
  const worthNavigating = useOverflows(scrollRef, sections)

  // A single subsection is just the panel again, and on a panel that fits on
  // screen every entry scrolls to what you can already see.
  if (sections.length < 2 || !worthNavigating) return null

  return (
    <div className="mt-1 ml-[1.375rem] flex flex-col">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() =>
            section.element.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          }
          className={cn(
            "truncate border-l-2 py-2 pl-3 text-left text-sm transition-colors",
            section.id === activeId
              ? "border-foreground text-foreground font-medium"
              : "border-border text-foreground-dim hover:border-foreground-muted hover:text-foreground",
          )}
        >
          {section.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Whether the panel is tall enough that jumping between sections beats
 * scrolling. Sections re-register and resize as panel data loads, so both feed
 * the measurement.
 */
function useOverflows(
  scrollRef: RefObject<HTMLDivElement | null>,
  sections: SettingsSection[],
) {
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) {
      setOverflows(false)
      return
    }

    // A quarter of a viewport of overflow is about where scrolling starts to
    // cost more than a click.
    const update = () =>
      setOverflows(scroller.scrollHeight > scroller.clientHeight * 1.25)

    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    for (const section of sections) observer.observe(section.element)
    return () => observer.disconnect()
  }, [scrollRef, sections])

  return overflows
}

function useSectionInView(
  scrollRef: RefObject<HTMLDivElement | null>,
  sections: SettingsSection[],
) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || sections.length === 0) {
      setActiveId(null)
      return
    }

    let frame = 0
    const update = () => {
      frame = 0
      // The last heading to pass the top quarter of the viewport is the section
      // being read. The final section is often too short to ever reach that
      // line, so hitting the bottom of the scroller selects it outright.
      const line =
        scroller.getBoundingClientRect().top + scroller.clientHeight / 4
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      const current = atBottom
        ? sections[sections.length - 1]
        : sections.reduce(
            (found, section) =>
              section.element.getBoundingClientRect().top <= line
                ? section
                : found,
            sections[0],
          )
      setActiveId(current.id)
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }

    update()
    scroller.addEventListener("scroll", schedule, { passive: true })
    // Async content growing an earlier section shifts every later heading
    // without a scroll event, so resizes feed the same recompute.
    const observer = new ResizeObserver(schedule)
    observer.observe(scroller)
    for (const section of sections) observer.observe(section.element)
    return () => {
      scroller.removeEventListener("scroll", schedule)
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scrollRef, sections])

  return activeId
}
