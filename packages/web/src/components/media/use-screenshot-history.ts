import { useRef, useState } from "react"

import type { ScreenshotEdit } from "./screenshot-edit"

type Snapshot = { edit: ScreenshotEdit; aspectRatio: string }
type History = {
  past: Snapshot[]
  present: Snapshot
  future: Snapshot[]
  start: Snapshot | null
}
type Action =
  | { type: "change" | "preview"; snapshot: Snapshot }
  | { type: "commit" | "undo" | "redo" }
const same = (a: Snapshot, b: Snapshot) =>
  JSON.stringify(a) === JSON.stringify(b)

export function createScreenshotHistory(edit: ScreenshotEdit): History {
  return {
    past: [],
    present: { edit, aspectRatio: "free" },
    future: [],
    start: null,
  }
}

export function screenshotHistory(history: History, action: Action): History {
  if (action.type === "preview") {
    if (same(history.present, action.snapshot)) return history
    return {
      ...history,
      start: history.start ?? history.present,
      present: action.snapshot,
    }
  }
  let next = history
  if (history.start) {
    next = same(history.start, history.present)
      ? { ...history, start: null }
      : {
          past: [...history.past, history.start],
          present: history.present,
          future: [],
          start: null,
        }
  }
  if (action.type === "commit") return next
  if (action.type === "change") {
    if (same(next.present, action.snapshot)) return next
    return {
      past: [...next.past, next.present],
      present: action.snapshot,
      future: [],
      start: null,
    }
  }
  if (action.type === "undo") {
    const previous = next.past.at(-1)
    return previous
      ? {
          past: next.past.slice(0, -1),
          present: previous,
          future: [next.present, ...next.future],
          start: null,
        }
      : next
  }
  const following = next.future[0]
  return following
    ? {
        past: [...next.past, next.present],
        present: following,
        future: next.future.slice(1),
        start: null,
      }
    : next
}

export function useScreenshotHistory(
  initial: ScreenshotEdit,
  onChange: (edit: ScreenshotEdit) => void,
) {
  const [history, setHistory] = useState(() => createScreenshotHistory(initial))
  const current = useRef(history)
  const dispatch = (action: Action) => {
    const previous = current.current
    const next = screenshotHistory(previous, action)
    current.current = next
    setHistory(next)
    if (next.present !== previous.present) onChange(next.present.edit)
  }
  return {
    snapshot: history.present,
    canUndo:
      history.past.length > 0 ||
      (history.start !== null && !same(history.start, history.present)),
    canRedo: history.future.length > 0 && history.start === null,
    change: (
      edit: ScreenshotEdit,
      aspectRatio = current.current.present.aspectRatio,
      preview = false,
    ) =>
      dispatch({
        type: preview ? "preview" : "change",
        snapshot: { edit, aspectRatio },
      }),
    commit: () => dispatch({ type: "commit" }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
  }
}
