"use client"

import { useEffect, useState } from "react"

export function useMediaQuery(query: string): boolean {
  // Initialize synchronously so the first render already reflects the
  // viewport — an effect-only update would flash the non-matching layout.
  const [matches, setMatches] = useState(
    () => canMatchMedia() && window.matchMedia(query).matches,
  )

  useEffect(() => {
    if (!canMatchMedia()) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener("change", onChange)
    setMatches(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}

function canMatchMedia() {
  return (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
  )
}
