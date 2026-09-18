import { detectLocale, type Locale } from "@alloy/i18n"
import type { Context } from "hono"

/**
 * Locale for server-rendered pages. The web app keeps its choice in
 * localStorage, which never reaches the server, so the browser's
 * `Accept-Language` header is the only signal available here.
 */
export function requestLocale(c: Context): Locale {
  return detectLocale(languagePreferences(c.req.header("accept-language")))
}

/** Tags ranked by an `Accept-Language` header, most preferred first. */
export function languagePreferences(header: string | undefined): string[] {
  if (!header) return []
  return header
    .split(",")
    .map((entry) => {
      const [tag = "", ...parameters] = entry.split(";")
      return { tag: tag.trim(), quality: qualityOf(parameters) }
    })
    .filter(({ tag, quality }) => tag.length > 0 && quality > 0)
    .sort((left, right) => right.quality - left.quality)
    .map(({ tag }) => tag)
}

/** `q=` weight of one `Accept-Language` entry: 1 when absent, 0 when invalid. */
function qualityOf(parameters: readonly string[]): number {
  const weighted = parameters
    .map((parameter) => parameter.trim())
    .find((parameter) => parameter.startsWith("q="))
  if (!weighted) return 1
  const quality = Number.parseFloat(weighted.slice(2))
  return Number.isFinite(quality) ? quality : 0
}
