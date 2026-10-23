// GitHub passes a missing secret or variable as an empty string, so treat that
// as missing too.
export const env = (name, fallback) => {
  const value = process.env[name] || fallback
  if (!value) throw new Error(`missing env ${name}`)
  return value
}

export const dryRun = process.env.GARDENER_DRY_RUN === "true"

/** Workflow log output; the repo lint forbids console. */
export const log = (message) => process.stdout.write(`${message}\n`)
