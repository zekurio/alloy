import * as React from "react"
import { AlertCircleIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

import {
  type AdminLimitsConfig,
  type AdminRuntimeConfig,
  updateLimitsConfig,
} from "../../../lib/admin-api"
import { clampInt } from "./shared"

type LimitsConfigCardProps = {
  limits: AdminLimitsConfig
  onChange: (next: AdminRuntimeConfig) => void
}

export function LimitsConfigCard({ limits, onChange }: LimitsConfigCardProps) {
  const [form, setForm] = React.useState<AdminLimitsConfig>(limits)
  const [pending, setPending] = React.useState(false)
  const [maxUploadMiB, setMaxUploadMiB] = React.useState<string>(() =>
    String(Math.round(limits.maxUploadBytes / (1024 * 1024)))
  )

  React.useEffect(() => {
    setForm(limits)
    setMaxUploadMiB(String(Math.round(limits.maxUploadBytes / (1024 * 1024))))
  }, [limits])

  function set<K extends keyof AdminLimitsConfig>(
    key: K,
    value: AdminLimitsConfig[K]
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    const parsedMiB = Number(maxUploadMiB)
    if (!Number.isFinite(parsedMiB) || parsedMiB <= 0) {
      toast.error("Max upload size must be a positive number of MiB.")
      return
    }
    setPending(true)
    try {
      const next = await updateLimitsConfig({
        ...form,
        maxUploadBytes: Math.round(parsedMiB * 1024 * 1024),
      })
      onChange(next)
      toast.success("Limits updated")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update limits"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Upload &amp; queue limits</CardTitle>
            <CardDescription>
              Per-file upload cap, ticket TTL, and worker concurrency.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="limits-max-upload">
                Max upload size (MiB)
              </FieldLabel>
              <Input
                id="limits-max-upload"
                type="number"
                min={1}
                max={64 * 1024}
                step={1}
                required
                value={maxUploadMiB}
                onChange={(e) => setMaxUploadMiB(e.target.value)}
              />
              <FieldDescription>
                Hard per-file cap enforced at <code>/initiate</code> and again
                inside the upload token. Server caps this at 64 GiB.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="limits-ttl">
                Upload ticket TTL (seconds)
              </FieldLabel>
              <Input
                id="limits-ttl"
                type="number"
                min={60}
                max={86_400}
                step={30}
                required
                value={form.uploadTtlSec}
                onChange={(e) =>
                  set(
                    "uploadTtlSec",
                    clampInt(e.target.value, 60, 86_400, form.uploadTtlSec)
                  )
                }
              />
              <FieldDescription>
                How long a freshly minted upload URL stays valid. 15 min is
                comfortable for slow connections.
              </FieldDescription>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="limits-concurrency">
              Queue concurrency
            </FieldLabel>
            <Input
              id="limits-concurrency"
              type="number"
              min={1}
              max={16}
              step={1}
              required
              value={form.queueConcurrency}
              onChange={(e) =>
                set(
                  "queueConcurrency",
                  clampInt(e.target.value, 1, 16, form.queueConcurrency)
                )
              }
            />
            <FieldDescription className="flex items-start gap-1.5">
              <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                How many encode jobs run in parallel. Changes here require a
                server restart — pg-boss registers concurrency once at boot.
              </span>
            </FieldDescription>
          </Field>
        </CardContent>

        <CardFooter>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save limits"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
