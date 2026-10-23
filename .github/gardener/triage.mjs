import {
  claude,
  fence,
  nullable,
  PROJECT,
  projectRules,
  repoMap,
  UNTRUSTED,
} from "./claude.mjs"
import { config } from "./config.mjs"
import { ensureLabels, FOOTER, gh, ghPaginate, ghWrite, R } from "./github.mjs"
import { log } from "./runtime.mjs"

const SYSTEM = [
  `You triage GitHub issues for ${PROJECT}.`,
  `Be conservative. Only flag a duplicate when the existing issue clearly describes the same problem or request, not merely the same area. Only mark needs_info for bug reports that genuinely lack what a maintainer needs to reproduce (steps, version, platform, logs for crashes) — never for feature requests that are merely brief.`,
  `Effort is the rough size of the fix or feature for a maintainer who knows the codebase: XS (< 1 hour, trivial), S (an afternoon), M (1-3 days), L (about a week), XL (multi-week or architectural). Use null when the report is too vague to size.`,
  `The comment is posted only when needs_info is true or duplicate_of is non-empty, so write null in every other case. Address the reporter directly, be friendly and brief (at most 4 sentences or a short list), do not restate their issue, and with needs_info ask for exactly what is missing. Links to the duplicate candidates are appended for you, so do not repeat their numbers.`,
  UNTRUSTED,
].join("\n\n")

const schema = (areaNames) => ({
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["bug", "feature", "question", "other"],
    },
    areas: {
      type: "array",
      items: { type: "string", enum: areaNames },
      description: "Affected parts of Alloy, at most two, most relevant first.",
    },
    effort: nullable({
      type: "string",
      enum: ["XS", "S", "M", "L", "XL"],
    }),
    needs_info: { type: "boolean" },
    duplicate_of: {
      type: "array",
      items: { type: "integer" },
      description:
        "At most three existing issue numbers that are clearly the same. Empty if unsure.",
    },
    comment: nullable({ type: "string" }),
    rationale: {
      type: "string",
      description:
        "One or two sentences justifying the decision, for the workflow log.",
    },
  },
  required: [
    "kind",
    "areas",
    "effort",
    "needs_info",
    "duplicate_of",
    "comment",
    "rationale",
  ],
  additionalProperties: false,
})

export async function triage(number) {
  const issue = await gh("GET", `${R}/issues/${number}`)
  if (issue.pull_request)
    return log(`#${number} is a pull request; skipping triage`)

  const others = (
    await ghPaginate(`${R}/issues?state=all&sort=created&direction=desc`, 300)
  ).filter((i) => i.number !== issue.number && !i.pull_request)

  const result = await claude({
    model: config.models.triage,
    effort: config.effort.triage,
    maxTokens: 4000,
    system: SYSTEM,
    user: prompt(issue, others),
    schema: schema(Object.keys(config.areas)),
  })
  log(JSON.stringify(result, null, 2))

  const known = new Set(others.map((i) => i.number))
  const duplicates = result.duplicate_of.filter((n) => known.has(n)).slice(0, 3)
  await applyLabels(issue, result, duplicates)
  await postComment(issue.number, result, duplicates)
}

function prompt(issue, others) {
  const index = others
    .map((i) => `#${i.number} [${i.state}] ${i.title}`)
    .join("\n")
  return [
    projectRules(),
    fence("repository_layout", repoMap()),
    fence("existing_issues", index || "(none)"),
    fence(
      "issue",
      `#${issue.number} by @${issue.user.login} (${issue.author_association})\nTitle: ${issue.title}\nCurrent labels: ${issue.labels.map((l) => l.name).join(", ") || "none"}\n\n${(issue.body ?? "").slice(0, 30_000)}`,
    ),
  ].join("\n\n")
}

/** Replace labels the gardener owns; leave maintainer-added labels alone. */
async function applyLabels(issue, result, duplicates) {
  const labels = [
    config.kinds[result.kind],
    ...result.areas.slice(0, 2).map((a) => config.areas[a]),
    result.effort ? `effort: ${result.effort}` : null,
    result.needs_info ? "needs info" : null,
    duplicates.length ? "possible duplicate" : null,
  ].filter(Boolean)

  const owned = new Set(Object.keys(config.labels))
  const kept = issue.labels.map((l) => l.name).filter((n) => !owned.has(n))
  await ensureLabels(labels)
  await ghWrite("PUT", `${R}/issues/${issue.number}/labels`, {
    labels: [...new Set([...kept, ...labels])],
  })
}

async function postComment(number, result, duplicates) {
  let comment = result.comment?.trim()
  if (duplicates.length) {
    const list = duplicates.map((n) => `- #${n}`).join("\n")
    comment = `${comment ? `${comment}\n\n` : ""}This looks related to:\n${list}`
  }
  if (comment && (result.needs_info || duplicates.length)) {
    await ghWrite("POST", `${R}/issues/${number}/comments`, {
      body: comment + FOOTER,
    })
  }
}
