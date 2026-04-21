import { z } from "zod"

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
