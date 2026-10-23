import { config } from "./config.mjs"
import { ensureLabels, gh, ghPaginate, ghWrite, R } from "./github.mjs"
import { log } from "./runtime.mjs"

/** Release-notes label for a conventional title: `type(scope)!: summary`. */
function changelogLabel(title) {
  const { types, breaking, fallback } = config.changelog
  const match = title.match(/^(?<type>\w+)(?:\([^)]*\))?(?<breaking>!)?:/i)
  if (match?.groups.breaking) return breaking
  const type = match?.groups.type.toLowerCase()
  return type && Object.hasOwn(types, type) ? types[type] : fallback
}

export async function changelog(number) {
  const issue = await gh("GET", `${R}/issues/${number}`)
  if (!issue.pull_request)
    return log(`#${number} is an issue; skipping changelog`)

  const label = changelogLabel(issue.title)
  const current = issue.labels
    .map((l) => l.name)
    .filter((n) => n.startsWith("changelog:"))
  if (current.length === 1 && current[0] === label)
    return log(`#${number} already has ${label}`)

  // The label follows the title until a person picks one; then it sticks.
  if (current.length) {
    const addedBy = new Map()
    for (const event of await ghPaginate(`${R}/issues/${number}/events`)) {
      if (event.event === "labeled") addedBy.set(event.label.name, event.actor)
    }
    const manual = current.filter((n) => addedBy.get(n)?.type !== "Bot")
    if (manual.length)
      return log(`#${number}: keeping ${manual.join(", ")}, set by a person`)
  }

  await ensureLabels(Object.keys(config.changelog.labels))
  await ghWrite("POST", `${R}/issues/${number}/labels`, { labels: [label] })
  for (const name of current.filter((n) => n !== label)) {
    try {
      await ghWrite(
        "DELETE",
        `${R}/issues/${number}/labels/${encodeURIComponent(name)}`,
      )
    } catch (error) {
      if (error.status !== 404) throw error
    }
  }
  log(`#${number}: ${current.join(", ") || "no category"} → ${label}`)
}

export async function lock() {
  const cutoff = new Date(
    Date.now() - config.lock.afterDays * 864e5,
  ).toISOString()
  // Oldest activity first; stop paging once threads are newer than the cutoff.
  const items = []
  for (let page = 1; items.length < config.lock.maxPerRun; page++) {
    const batch = await gh(
      "GET",
      `${R}/issues?state=closed&sort=updated&direction=asc&per_page=100&page=${page}`,
    )
    const stale = batch.filter((i) => i.updated_at < cutoff)
    items.push(...stale.filter((i) => !i.locked))
    if (batch.length < 100 || stale.length < batch.length) break
  }
  items.splice(config.lock.maxPerRun)
  for (const item of items) {
    await ghWrite("PUT", `${R}/issues/${item.number}/lock`, {
      lock_reason: "resolved",
    })
    log(`locked #${item.number} ${item.title}`)
  }
  log(`locked ${items.length} thread(s) inactive since ${cutoff}`)
}
