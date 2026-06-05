import * as React from "react"

/**
 * Playful, nonsense-y gerunds shown while the model squints at frames trying
 * to name the game. Kept short so they fit inside the game input, and in the
 * spirit of Claude Code's spinner verbs — never a literal description of the
 * work, always a little wink.
 */
const SUGGESTION_VERBS = [
  "Squinting at pixels",
  "Divining the game",
  "Scrying the footage",
  "Eyeballing frames",
  "Consulting the oracle",
  "Interrogating pixels",
  "Sniffing out the game",
  "Reticulating frames",
  "Pondering the vibes",
  "Frame-gazing",
  "Decoding the chaos",
  "Channeling the meta",
  "Reading the tea leaves",
  "Vibe-checking the clip",
] as const

const VERB_INTERVAL_MS = 1800

/** Cycles through {@link SUGGESTION_VERBS} while `active`, starting at a random
 *  verb so two pickers don't visibly march in lockstep. */
export function useCyclingVerb(active: boolean): string {
  const [index, setIndex] = React.useState(() =>
    Math.floor(Math.random() * SUGGESTION_VERBS.length),
  )

  React.useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % SUGGESTION_VERBS.length)
    }, VERB_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [active])

  return SUGGESTION_VERBS[index] ?? SUGGESTION_VERBS[0]
}
