import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

/**
 * `drizzle-kit generate` diffs the schema against the newest snapshot in
 * `drizzle/meta`, so it emits a file exactly when the two have drifted. Running
 * it against a throwaway copy of the migration directory turns that into an
 * assertion: schema edits that never got a migration are caught here instead of
 * at deploy, when `migrate` leaves production missing a column.
 *
 * No database is involved - generate is offline, and DATABASE_URL only has to
 * parse for the config to load.
 */
const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..")
// Staged under node_modules so it is already ignored, and so the generated
// config can still resolve drizzle-kit by name.
const scratchDir = join(packageDir, "node_modules", ".drift-check")

after(() => rmSync(scratchDir, { recursive: true, force: true }))

test("schema and migrations agree", () => {
  rmSync(scratchDir, { recursive: true, force: true })
  mkdirSync(scratchDir, { recursive: true })
  cpSync(join(packageDir, "drizzle"), join(scratchDir, "drizzle"), {
    recursive: true,
  })

  const configPath = join(scratchDir, "drizzle.config.ts")
  writeFileSync(
    configPath,
    `import { defineConfig } from "drizzle-kit"
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema/index.ts", "./src/schema/auth.ts"],
  out: "node_modules/.drift-check/drizzle",
})
`,
  )

  const before = migrationFiles()
  const result = spawnSync(
    "drizzle-kit",
    ["generate", "--config", configPath, "--name", "drift_check"],
    {
      cwd: packageDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // A rename drizzle-kit cannot resolve on its own would otherwise prompt
      // and hang; with stdin closed it exits instead.
      timeout: 120_000,
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.DATABASE_URL ?? "postgres://drift:drift@127.0.0.1:5432/x",
      },
    },
  )

  assert.equal(
    result.status,
    0,
    `drizzle-kit generate failed:\n${result.stdout}\n${result.stderr}`,
  )

  const added = migrationFiles().filter((name) => !before.includes(name))
  assert.deepEqual(
    added,
    [],
    "The schema has changes with no migration. Run `pnpm db:generate` and " +
      "commit the result.",
  )
})

function migrationFiles(): string[] {
  return readdirSync(join(scratchDir, "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
}
