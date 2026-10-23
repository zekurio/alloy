import {
  claude,
  fence,
  nullable,
  PROJECT,
  projectRules,
  repoFile,
  UNTRUSTED,
} from "./claude.mjs"
import { config } from "./config.mjs"
import { FOOTER, gh, ghPaginate, ghWrite, R } from "./github.mjs"
import { log } from "./runtime.mjs"

const SYSTEM = [
  `You are a senior reviewer for ${PROJECT}.`,
  `Review the pull request the way a careful maintainer would. Prioritise, in order: correctness bugs, security problems (auth, origin validation, path handling, injection, secrets, unsafe native bridge use), data loss, breaking desktop/server compatibility, then violations of the project rules below. Mention style only when it breaks a written project rule; formatting and lint are enforced by CI, so never comment on them.`,
  `Every finding must be concrete and actionable, point at a specific changed line, and explain the consequence. Do not praise, do not restate what the PR does line by line, and do not pad: an empty findings list is a good result for a clean PR. Prefer fewer high-confidence findings over many speculative ones; if you are unsure, say what you would check rather than asserting a bug.`,
  `Line numbers: use the right-hand (new file) numbers printed at the start of each diff line. Only lines shown with a number are valid targets. For a suggestion, give the exact replacement text for lines start_line..line (inclusive) of the new file, preserving indentation, or omit it.`,
  UNTRUSTED,
].join("\n\n")

const SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "2-5 sentences: overall assessment and the most important risks. Markdown.",
    },
    verdict: {
      type: "string",
      enum: ["looks_good", "minor_issues", "needs_changes"],
    },
    findings: {
      type: "array",
      description: `At most ${config.review.maxFindings} findings, most severe first.`,
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          line: { type: "integer" },
          start_line: nullable({ type: "integer" }),
          severity: {
            type: "string",
            enum: ["blocker", "major", "minor", "nit"],
          },
          title: { type: "string" },
          body: { type: "string" },
          suggestion: nullable({ type: "string" }),
        },
        required: ["path", "line", "severity", "title", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "verdict", "findings"],
  additionalProperties: false,
}

const ICON = { blocker: "🛑", major: "⚠️", minor: "💡", nit: "🪶" }
const VERDICT = {
  looks_good: "✅ Looks good",
  minor_issues: "💡 Minor issues",
  needs_changes: "⚠️ Needs changes",
}

const isIgnored = (path) => config.review.ignore.some((re) => re.test(path))

export async function review(number) {
  const pr = await gh("GET", `${R}/pulls/${number}`)
  if (pr.state !== "open") return log(`#${number} is not open; skipping review`)

  const files = (await ghPaginate(`${R}/pulls/${number}/files`, 3000)).filter(
    (f) => !isIgnored(f.filename),
  )
  if (!files.length) return log("no reviewable files")

  const diffs = collectDiffs(files)
  const context = await collectContext(files, pr.head.sha, diffs.commentable)

  const result = await claude({
    model: config.models.review,
    effort: config.effort.review,
    maxTokens: 12_000,
    system: SYSTEM,
    user: prompt(pr, files, diffs, context),
    schema: SCHEMA,
  })
  log(JSON.stringify(result, null, 2))

  const { inline, loose } = placeFindings(result.findings, diffs.commentable)
  // Always COMMENT: the bot informs, maintainers approve or request changes.
  await ghWrite("POST", `${R}/pulls/${number}/reviews`, {
    commit_id: pr.head.sha,
    event: "COMMENT",
    body: summary(result, loose, diffs.skipped) + FOOTER,
    comments: inline,
  })
}

/** Render a unified-diff patch with right-side line numbers, and collect the commentable lines. */
function annotatePatch(patch) {
  const lines = []
  const commentable = new Set()
  let right = 0
  for (const raw of patch.split("\n")) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      right = Number(hunk[1])
      lines.push(raw)
    } else if (raw.startsWith("-")) {
      lines.push(`      ${raw}`)
    } else if (raw.startsWith("\\")) {
      lines.push(raw)
    } else {
      commentable.add(right)
      lines.push(`${String(right).padStart(5)} ${raw}`)
      right++
    }
  }
  return { text: lines.join("\n"), commentable }
}

/** Fenced diffs within the character budget, the commentable lines per file, and what was left out. */
function collectDiffs(files) {
  const commentable = new Map()
  const parts = []
  const skipped = []
  let budget = config.review.maxDiffChars
  for (const file of files) {
    if (!file.patch) {
      skipped.push(
        `${file.filename} (${file.status}, binary or too large for the API diff)`,
      )
      continue
    }
    const { text, commentable: lines } = annotatePatch(file.patch)
    if (text.length > budget) {
      skipped.push(`${file.filename} (diff over budget)`)
      continue
    }
    budget -= text.length
    commentable.set(file.filename, lines)
    parts.push(
      fence("diff", `File: ${file.filename} (${file.status})\n${text}`),
    )
  }
  return { parts, commentable, skipped }
}

/** Full post-change contents of the touched files give the model surrounding context. */
async function collectContext(files, sha, commentable) {
  const parts = []
  let budget = config.review.maxContextChars
  for (const file of files) {
    if (file.status === "removed" || !commentable.has(file.filename)) continue
    try {
      const blob = await gh(
        "GET",
        `${R}/contents/${encodeURIComponent(file.filename).replace(/%2F/g, "/")}?ref=${sha}`,
      )
      if (blob.encoding !== "base64" || blob.size > config.review.maxFileBytes)
        continue
      const content = Buffer.from(blob.content, "base64").toString("utf8")
      if (content.length > budget) continue
      budget -= content.length
      parts.push(
        fence("file", `Path: ${file.filename} (after this PR)\n${content}`),
      )
    } catch (error) {
      log(`could not fetch ${file.filename}: ${error.message}`)
    }
  }
  return parts
}

/** Nearest package READMEs carry subsystem conventions. */
function packageReadmes(files) {
  const packages = new Set(
    files.map((f) => f.filename.match(/^packages\/[^/]+/)?.[0]).filter(Boolean),
  )
  return [...packages]
    .map((p) => [p, repoFile(`${p}/README.md`, 10_000)])
    .filter(([, text]) => text)
    .map(([p, text]) => fence("package_readme", `${p}/README.md\n${text}`))
}

function prompt(pr, files, diffs, context) {
  return [
    projectRules(),
    fence("contributing", repoFile(".github/CONTRIBUTING.md")),
    ...packageReadmes(files),
    fence(
      "pull_request",
      `#${pr.number} by @${pr.user.login} (${pr.author_association})\n${pr.head.label} → ${pr.base.ref}\nTitle: ${pr.title}\n\n${(pr.body ?? "").slice(0, 20_000)}`,
    ),
    diffs.skipped.length ? fence("not_shown", diffs.skipped.join("\n")) : "",
    ...context,
    ...diffs.parts,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** Findings on a numbered diff line become inline comments; the rest go in the summary. */
function placeFindings(findings, commentable) {
  const inline = []
  const loose = []
  for (const f of findings.slice(0, config.review.maxFindings)) {
    const valid = commentable.get(f.path)
    const start = f.start_line && f.start_line < f.line ? f.start_line : null
    const onDiff = valid?.has(f.line) && (!start || valid.has(start))
    let body = `${ICON[f.severity]} **${f.title}**\n\n${f.body}`
    if (onDiff && f.suggestion != null)
      body += `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``
    if (onDiff) {
      const comment = { path: f.path, line: f.line, side: "RIGHT", body }
      if (start) {
        comment.start_line = start
        comment.start_side = "RIGHT"
      }
      inline.push(comment)
    } else {
      loose.push(`- \`${f.path}:${f.line}\` ${body.replace(/\n\n/g, " — ")}`)
    }
  }
  return { inline, loose }
}

function summary(result, loose, skipped) {
  let text = `### ${VERDICT[result.verdict]}\n\n${result.summary}`
  if (loose.length) text += `\n\n**Outside the diff**\n${loose.join("\n")}`
  if (skipped.length)
    text += `\n\n<details><summary>Not reviewed (${skipped.length})</summary>\n\n${skipped.map((s) => `- ${s}`).join("\n")}\n</details>`
  return text
}
