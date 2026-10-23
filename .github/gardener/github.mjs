import { config } from "./config.mjs"
import { dryRun, env, log } from "./runtime.mjs"

const [owner, repo] = env("GITHUB_REPOSITORY").split("/")

/** Path prefix for every call against this repository. */
export const R = `/repos/${owner}/${repo}`

const MARKER = "<!-- alloy-gardener -->"
export const FOOTER = `\n\n<sub>🌱 alloy-gardener · automated, may be wrong · maintainers: \`/gardener review\` or \`/gardener triage\` to re-run</sub>\n${MARKER}`

export async function gh(method, path, body) {
  const init = {
    method,
    headers: {
      authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "alloy-gardener",
    },
  }
  if (body) {
    init.headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`https://api.github.com${path}`, init)
  if (res.status === 204) return null
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const error = new Error(
      `GitHub ${method} ${path}: ${res.status} ${text.slice(0, 500)}`,
    )
    error.status = res.status
    throw error
  }
  return data
}

export async function ghWrite(method, path, body) {
  if (dryRun) {
    log(`[dry-run] ${method} ${path}\n${JSON.stringify(body, null, 2)}`)
    return null
  }
  return gh(method, path, body)
}

export async function ghPaginate(path, max = 1000) {
  const items = []
  for (let page = 1; items.length < max; page++) {
    const sep = path.includes("?") ? "&" : "?"
    const batch = await gh("GET", `${path}${sep}per_page=100&page=${page}`)
    items.push(...batch)
    if (batch.length < 100) break
  }
  return items.slice(0, max)
}

export async function ensureLabels(names) {
  for (const name of names) {
    const spec = config.labels[name] ?? config.changelog.labels[name]
    if (!spec) throw new Error(`label ${name} not declared in config.mjs`)
    try {
      await gh("GET", `${R}/labels/${encodeURIComponent(name)}`)
    } catch (error) {
      if (error.status !== 404) throw error
      await ghWrite("POST", `${R}/labels`, { name, ...spec })
    }
  }
}
