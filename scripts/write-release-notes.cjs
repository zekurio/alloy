const fs = require("node:fs")

async function writeReleaseNotes({
  github,
  context,
  core,
  tag,
  ref,
  previousTag,
}) {
  const { owner, repo } = context.repo
  const releaseNotesRequest = {
    owner,
    repo,
    tag_name: tag,
    target_commitish: ref,
  }
  if (previousTag) releaseNotesRequest.previous_tag_name = previousTag

  let generatedNotes = ""
  try {
    const response =
      await github.rest.repos.generateReleaseNotes(releaseNotesRequest)
    generatedNotes = response.data.body.trim()
  } catch (error) {
    core.warning(`Could not generate GitHub release notes: ${error.message}`)
    generatedNotes = previousTag
      ? `**Full Changelog**: https://github.com/${owner}/${repo}/compare/${previousTag}...${tag}`
      : `**Full Changelog**: https://github.com/${owner}/${repo}/commits/${tag}`
  }

  const hasGeneratedEntries = generatedNotes
    .split("\n")
    .some((line) => /^[-*] /.test(line) && !line.includes("Full Changelog"))

  if (!hasGeneratedEntries && previousTag) {
    try {
      const comparison = await github.rest.repos.compareCommits({
        owner,
        repo,
        base: previousTag,
        head: tag,
      })
      const categories = new Map([
        ["Features", []],
        ["Bug fixes", []],
        ["Performance", []],
        ["Improvements", []],
        ["Documentation", []],
        ["Other changes", []],
      ])

      for (const commit of comparison.data.commits) {
        const subject = commit.commit.message.split("\n", 1)[0]
        if (/^chore: release v?\d+\.\d+\.\d+$/i.test(subject)) continue

        const match = subject.match(
          /^(?<type>\w+)(?:\([^)]*\))?!?:\s+(?<summary>.+)$/i,
        )
        const type = match?.groups?.type?.toLowerCase()
        const category =
          {
            feat: "Features",
            fix: "Bug fixes",
            perf: "Performance",
            refactor: "Improvements",
            docs: "Documentation",
          }[type] ?? "Other changes"
        const summary = match?.groups?.summary ?? subject
        categories
          .get(category)
          .push(
            `- ${summary} ([${commit.sha.slice(0, 7)}](https://github.com/${owner}/${repo}/commit/${commit.sha}))`,
          )
      }

      const commitNotes = [...categories]
        .filter(([, entries]) => entries.length > 0)
        .flatMap(([category, entries]) => [
          `### ${category}`,
          "",
          ...entries,
          "",
        ])
        .join("\n")
        .trim()

      if (commitNotes) {
        generatedNotes = [
          "## What's changed",
          "",
          commitNotes,
          "",
          `**Full Changelog**: https://github.com/${owner}/${repo}/compare/${previousTag}...${tag}`,
        ].join("\n")
      }
    } catch (error) {
      core.warning(
        `Could not generate commit-based release notes: ${error.message}`,
      )
    }
  }

  fs.writeFileSync("release-notes.md", `${generatedNotes}\n`)
}

module.exports = { writeReleaseNotes }
