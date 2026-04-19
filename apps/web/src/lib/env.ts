import { z } from "zod"

/**
 * Web-app environment schema.
 *
 * Vite only exposes variables prefixed with `VITE_` to the client bundle, so
 * that's all we validate here. Validation runs on module import — if anything
 * is missing or malformed, the app fails fast at load time with a readable
 * error instead of mysteriously failing a fetch later.
 *
 * Defaults mirror local-dev: Hono server on :3000, Vite on :5173.
 */
const EnvSchema = z.object({
  VITE_API_URL: z.string().url().default("http://localhost:3000"),
})

const parsed = EnvSchema.safeParse(import.meta.env)

if (!parsed.success) {
  const fieldErrors = parsed.error.flatten().fieldErrors
  // eslint-disable-next-line no-console
  console.error(
    "[web/env] Invalid VITE_* environment variables:\n" +
      JSON.stringify(fieldErrors, null, 2)
  )
  throw new Error(
    "Invalid web environment variables — see console for field-level errors."
  )
}

export const env = parsed.data
