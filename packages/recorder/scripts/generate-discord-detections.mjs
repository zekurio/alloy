/* eslint-disable no-console */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const recorderDir = fileURLToPath(new URL("../", import.meta.url))
const outputPath = join(
  recorderDir,
  "src",
  "detections",
  "discordDetectable.generated.json",
)
const sourceUrl = "https://discord.com/api/v9/applications/detectable"

const response = await fetch(sourceUrl, {
  headers: { accept: "application/json" },
})

if (!response.ok) {
  throw new Error(
    `Discord detectable games request failed: ${response.status} ${response.statusText}`,
  )
}

const payload = await response.json()
if (!Array.isArray(payload)) {
  throw new Error("Discord detectable games response was not an array")
}

const games = []
const executables = new Map()

for (const raw of payload) {
  if (!raw || typeof raw !== "object") continue
  const id = stringValue(raw.id)
  const name = stringValue(raw.name)
  if (!id || !name) continue

  const aliases = arrayStrings(raw.aliases)
  const iconHash = stringValue(raw.icon_hash)
  const executableRows = []

  for (const executable of Array.isArray(raw.executables)
    ? raw.executables
    : []) {
    if (!executable || typeof executable !== "object") continue
    if (executable.os !== "win32") continue

    const executableName = stringValue(executable.name)
    const key = executableKey(executableName)
    if (!executableName || !key) continue

    const isLauncher = executable.is_launcher === true
    executableRows.push({
      name: executableName,
      key,
      isLauncher,
    })

    const matches = executables.get(key) ?? []
    matches.push({
      gameId: id,
      isLauncher,
      score: isLauncher ? 82 : 112,
    })
    executables.set(key, matches)
  }

  if (executableRows.length === 0) continue

  games.push({
    id,
    name,
    aliases,
    iconHash: iconHash || null,
    executables: uniqueExecutableRows(executableRows),
  })
}

games.sort((left, right) => left.name.localeCompare(right.name))
const executableIndex = Object.fromEntries(
  [...executables.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, matches]) => [
      key,
      matches
        .sort((left, right) => right.score - left.score)
        .filter(
          (match, index, items) =>
            items.findIndex(
              (candidate) => candidate.gameId === match.gameId,
            ) === index,
        ),
    ]),
)

const nextPayload = {
  schemaVersion: 1,
  source: "discord-detectable",
  sourceUrl,
  generatedAt: new Date().toISOString(),
  games,
  executables: executableIndex,
}
const existing = readExistingPayload()
if (existing && sameDetectorPayload(existing, nextPayload)) {
  nextPayload.generatedAt =
    typeof existing.generatedAt === "string"
      ? existing.generatedAt
      : nextPayload.generatedAt
}

const nextJson = `${JSON.stringify(nextPayload, null, 2)}\n`
mkdirSync(dirname(outputPath), { recursive: true })
if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== nextJson) {
  writeFileSync(outputPath, nextJson)
}

console.log(
  `Generated Discord detections: ${games.length} games, ${executables.size} executable keys`,
)

function stringValue(value) {
  return typeof value === "string" ? value.trim() : ""
}

function arrayStrings(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(stringValue).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  )
}

function executableKey(value) {
  if (!value) return ""
  return basename(value.replaceAll("\\", "/")).trim().toLowerCase()
}

function uniqueExecutableRows(rows) {
  return rows
    .filter(
      (row, index, items) =>
        items.findIndex(
          (candidate) =>
            candidate.key === row.key &&
            candidate.isLauncher === row.isLauncher,
        ) === index,
    )
    .sort((left, right) => left.key.localeCompare(right.key))
}

function readExistingPayload() {
  if (!existsSync(outputPath)) return null
  try {
    return JSON.parse(readFileSync(outputPath, "utf8"))
  } catch {
    return null
  }
}

function sameDetectorPayload(existing, next) {
  return (
    JSON.stringify({ ...existing, generatedAt: null }) ===
    JSON.stringify({ ...next, generatedAt: null })
  )
}
