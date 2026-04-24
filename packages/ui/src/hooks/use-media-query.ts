import * as React from "react"

/**
 * Subscribe to a CSS media-query and return whether it currently matches.
 *
 * ```ts
 * const isLg = useMediaQuery("(min-width: 1024px)")
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener("change", onChange)
    setMatches(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}
