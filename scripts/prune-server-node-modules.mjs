#!/usr/bin/env node

/* eslint-disable no-console */

// Build a pruned production node_modules for the server package by walking
// the pnpm virtual store closure of the server's external dependencies.
// Workspace (@alloy/*) packages are excluded: the server bundle inlines them
// and only their externalized deps (declared in the server package.json)
// are required at runtime. Runs fully offline; used by nix/package.nix.

import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
} from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

const repoRoot = resolve(process.argv[2] ?? "")
const outServerDir = resolve(process.argv[3] ?? "")

if (!repoRoot || !outServerDir) {
  console.error(
    "Usage: node scripts/prune-server-node-modules.mjs <repoRoot> <outServerDir>",
  )
  process.exit(1)
}

const serverDir = join(repoRoot, "packages", "server")
const pnpmStore = join(repoRoot, "node_modules", ".pnpm")

const serverPkg = JSON.parse(
  readFileSync(join(serverDir, "package.json"), "utf8"),
)
const directDeps = Object.keys(serverPkg.dependencies ?? {}).filter(
  (name) => !name.startsWith("@alloy/"),
)

const storeEntryOf = (realPath) => {
  const rel = relative(pnpmStore, realPath)
  if (rel.startsWith("..")) {
    return null
  }
  return rel.split(sep)[0]
}

const safeRealpath = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

const listModuleNames = (nodeModulesDir) => {
  const names = []
  let children = []
  try {
    children = readdirSync(nodeModulesDir)
  } catch {
    return names
  }
  for (const child of children) {
    if (child === ".bin" || child === ".modules.yaml") {
      continue
    }
    if (child.startsWith("@")) {
      for (const scoped of readdirSync(join(nodeModulesDir, child))) {
        names.push(join(child, scoped))
      }
    } else {
      names.push(child)
    }
  }
  return names
}

const seen = new Set()
const queue = []

const enqueue = (linkPath) => {
  const real = safeRealpath(linkPath)
  if (!real) {
    return
  }
  const entry = storeEntryOf(real)
  if (entry && !seen.has(entry)) {
    seen.add(entry)
    queue.push(entry)
  }
}

for (const name of directDeps) {
  enqueue(join(serverDir, "node_modules", name))
}

while (queue.length > 0) {
  const entry = queue.pop()
  const entryModules = join(pnpmStore, entry, "node_modules")
  for (const name of listModuleNames(entryModules)) {
    const candidate = join(entryModules, name)
    if (lstatSync(candidate).isSymbolicLink()) {
      enqueue(candidate)
    }
  }
}

const outModules = join(outServerDir, "node_modules")
mkdirSync(join(outModules, ".pnpm"), { recursive: true })

for (const entry of seen) {
  cpSync(join(pnpmStore, entry), join(outModules, ".pnpm", entry), {
    recursive: true,
    verbatimSymlinks: true,
  })
}

for (const name of directDeps) {
  const real = safeRealpath(join(serverDir, "node_modules", name))
  if (!real) {
    console.error(`Could not resolve direct dependency: ${name}`)
    process.exit(1)
  }
  const target = join(outModules, ".pnpm", relative(pnpmStore, real))
  const linkPath = join(outModules, name)
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(relative(dirname(linkPath), target), linkPath)
}

console.log(
  `Pruned server node_modules: ${seen.size} store entries for ${directDeps.length} direct dependencies.`,
)
