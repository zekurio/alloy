import * as React from "react"

import type { ClipRow } from "@workspace/api"

export interface ClipListEntry {
  id: string
  gameSlug: string | null
  row?: ClipRow
}

export interface ClipListContextValue {
  /** Ordered entries for the list the current modal is part of. */
  entries: readonly ClipListEntry[]
  /** Stable key so consumers can tell lists apart. */
  key: string
  /** Resolves the next entry in the list (or `null` when at the end). */
  nextOf(clipId: string): ClipListEntry | null
  /** Resolves the previous entry in the list (or `null` when at the start). */
  prevOf(clipId: string): ClipListEntry | null
}

function buildList(
  listKey: string,
  entries: readonly ClipListEntry[]
): ClipListContextValue {
  // Snapshot so later mutations of the caller's array don't corrupt our
  // neighbour lookups.
  const snapshot = entries.slice()
  const index = new Map<string, number>()
  for (let i = 0; i < snapshot.length; i++) {
    index.set(snapshot[i]!.id, i)
  }
  return {
    entries: snapshot,
    key: listKey,
    nextOf(clipId) {
      const i = index.get(clipId)
      if (i === undefined) return null
      return snapshot[i + 1] ?? null
    },
    prevOf(clipId) {
      const i = index.get(clipId)
      if (i === undefined) return null
      return snapshot[i - 1] ?? null
    },
  }
}

const ClipListContext = React.createContext<ClipListContextValue | null>(null)

export function ClipListProvider({
  listKey,
  entries,
  children,
}: {
  listKey: string
  entries: readonly ClipListEntry[]
  children: React.ReactNode
}) {
  const value = React.useMemo(
    () => buildList(listKey, entries),
    [entries, listKey]
  )
  return (
    <ClipListContext.Provider value={value}>
      {children}
    </ClipListContext.Provider>
  )
}

/**
 * Read the active list from the surrounding provider. Returns `null`
 * when no provider is in scope.
 */
export function useClipList(): ClipListContextValue | null {
  return React.useContext(ClipListContext)
}

let activeList: ClipListContextValue | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Write the active list; `null` clears it. */
export function setActiveClipList(list: ClipListContextValue | null): void {
  if (activeList === list) return
  activeList = list
  emit()
}

/**
 * Subscribe to the active list. Returns the current list, re-rendering
 * whenever a different list becomes active (or it's cleared).
 */
export function useActiveClipList(): ClipListContextValue | null {
  return React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    () => activeList,
    // SSR — no active list before hydration.
    () => null
  )
}
