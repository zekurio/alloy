import { useEffect, useLayoutEffect, useRef } from "react"
import type { TouchEvent, TouchList } from "react"

/** Share of the page height a slow drag must travel to turn the page. */
const COMMIT_FRACTION = 0.2
/** Release speed, in px/ms, at which a short flick turns the page. */
const FLICK_VELOCITY = 0.35
/** A release this long after the last move carries no flick speed. */
const FLICK_STALE_MS = 80
/** Travel before a touch commits to paging or to a sideways gesture. */
const AXIS_LOCK_PX = 10
/** Drag damping past the first or last entry. */
const EDGE_RESISTANCE = 0.25
const SETTLE_MS = 280
const SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
/** Gives up on a page turn whose navigation never swapped the page. */
const PAGE_SWAP_TIMEOUT_MS = 1500

type Drag = {
  id: number
  startX: number
  startY: number
  axis: "pending" | "y" | "x"
  lastY: number
  lastT: number
  /** Smoothed finger speed in px/ms; negative is upward. */
  velocity: number
}

function findTouch(list: TouchList, id: number) {
  for (let index = 0; index < list.length; index++) {
    const touch = list.item(index)
    if (touch?.identifier === id) return touch
  }
  return null
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Feed-style vertical paging for a full-screen viewer: the page follows the
 * finger, a long drag or a flick turns it, and anything short of that springs
 * back. Neighbours render above and below the track, so the next entry slides
 * in under the finger. Touches inside `[data-zoomed]` belong to that element.
 *
 * `pageKey` identifies the page on screen; when it changes the track snaps
 * back to rest in the same frame, so the new page replaces the neighbour that
 * slid in without a jump.
 */
export function useVerticalPaging<T>({
  prev,
  next,
  onPage,
  pageKey,
}: {
  prev: T | null
  next: T | null
  onPage: ((target: T) => void) | null
  pageKey: string
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const settlingRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const place = (offset: number, animate: boolean) => {
    const track = trackRef.current
    if (!track) return
    track.style.transition = animate
      ? `transform ${SETTLE_MS}ms ${SETTLE_EASING}`
      : "none"
    track.style.transform = offset === 0 ? "" : `translate3d(0, ${offset}px, 0)`
  }

  const settle = (offset: number, onDone?: () => void) => {
    clearTimer()
    if (prefersReducedMotion()) {
      place(offset, false)
      onDone?.()
      return
    }
    place(offset, true)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      onDone?.()
    }, SETTLE_MS)
  }

  useLayoutEffect(() => {
    clearTimer()
    settlingRef.current = false
    dragRef.current = null
    place(0, false)
  }, [pageKey])

  useEffect(() => clearTimer, [])

  const turnPage = (target: T, offset: number) => {
    settlingRef.current = true
    settle(offset, () => {
      onPage?.(target)
      // A navigation that never lands would leave the neighbour on screen.
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (!settlingRef.current) return
        settlingRef.current = false
        place(0, false)
      }, PAGE_SWAP_TIMEOUT_MS)
    })
  }

  const springBack = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.axis === "y") settle(0)
  }

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (!onPage || settlingRef.current) return
    if (event.touches.length !== 1) {
      springBack()
      return
    }
    if (
      event.target instanceof Element &&
      event.target.closest("[data-zoomed]")
    ) {
      return
    }
    const touch = event.touches.item(0)
    if (!touch) return
    dragRef.current = {
      id: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      axis: "pending",
      lastY: touch.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    }
  }

  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const touch = findTouch(event.touches, drag.id)
    if (!touch) return
    const dx = touch.clientX - drag.startX
    const dy = touch.clientY - drag.startY
    if (drag.axis === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return
      drag.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x"
    }
    if (drag.axis !== "y") return

    const dt = event.timeStamp - drag.lastT
    if (dt > 0) {
      const sample = (touch.clientY - drag.lastY) / dt
      drag.velocity = drag.velocity * 0.4 + sample * 0.6
    }
    drag.lastY = touch.clientY
    drag.lastT = event.timeStamp

    const blocked = (dy < 0 && !next) || (dy > 0 && !prev)
    place(blocked ? dy * EDGE_RESISTANCE : dy, false)
  }

  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const touch = findTouch(event.changedTouches, drag.id)
    if (!touch) return
    dragRef.current = null
    if (drag.axis !== "y") return

    const height = trackRef.current?.clientHeight ?? window.innerHeight
    const dy = touch.clientY - drag.startY
    const velocity =
      event.timeStamp - drag.lastT > FLICK_STALE_MS ? 0 : drag.velocity
    const target = dy < 0 ? next : prev
    const flicked =
      Math.abs(velocity) >= FLICK_VELOCITY &&
      Math.sign(velocity) === Math.sign(dy)
    // A drag pulled back against its direction cancels, however far it went.
    const reversed =
      Math.abs(velocity) >= FLICK_VELOCITY &&
      Math.sign(velocity) !== Math.sign(dy)
    if (
      target !== null &&
      !reversed &&
      (flicked || Math.abs(dy) >= height * COMMIT_FRACTION)
    ) {
      turnPage(target, dy < 0 ? -height : height)
      return
    }
    settle(0)
  }

  return {
    trackRef,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: springBack,
    },
  }
}
