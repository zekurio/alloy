import * as React from "react"
import { SaveIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Section,
  SectionContent,
  SectionFooter,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/lib/toast"

import type {
  AdminMachineLearningConfig,
  AdminRuntimeConfig,
} from "@workspace/api"

import { api } from "@/lib/api"
import { FormGroup } from "./form-group"
import { clampInt } from "./shared"

type MachineLearningConfigCardProps = {
  machineLearning: AdminMachineLearningConfig
  onChange: (next: AdminRuntimeConfig) => void
  hideHeader?: boolean
}

function copyConfig(
  machineLearning: AdminMachineLearningConfig
): AdminMachineLearningConfig {
  return {
    ...machineLearning,
    gameClassifier: { ...machineLearning.gameClassifier },
  }
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function basename(value: string): string {
  return value.replace(/\/+$/, "").split(/[\\/]/).pop() ?? value
}

function stripExtension(value: string): string {
  return value.replace(/\.[^.]+$/, "")
}

function derivedModelName(
  classifier: AdminMachineLearningConfig["gameClassifier"]
): string {
  const checkpointPath = trimOrNull(classifier.checkpointPath)
  if (checkpointPath) return stripExtension(basename(checkpointPath))

  const repoName = basename(classifier.repoId.trim())
  return repoName || "game-classifier"
}

function derivedModelVersion(
  classifier: AdminMachineLearningConfig["gameClassifier"]
): string | null {
  if (trimOrNull(classifier.checkpointPath)) return null
  return classifier.revision.trim() || null
}

function normalizedConfig(
  machineLearning: AdminMachineLearningConfig
): AdminMachineLearningConfig {
  const classifier = machineLearning.gameClassifier
  return {
    enabled: machineLearning.enabled,
    baseUrl: machineLearning.baseUrl.trim(),
    requestTimeoutMs: machineLearning.requestTimeoutMs,
    gameClassifier: {
      modelName: derivedModelName(classifier),
      modelVersion: derivedModelVersion(classifier),
      repoId: classifier.repoId.trim(),
      filename: classifier.filename.trim(),
      revision: classifier.revision.trim(),
      checkpointPath: trimOrNull(classifier.checkpointPath),
    },
  }
}

function configsEqual(
  left: AdminMachineLearningConfig,
  right: AdminMachineLearningConfig
): boolean {
  return (
    JSON.stringify(normalizedConfig(left)) ===
    JSON.stringify(normalizedConfig(right))
  )
}

export function MachineLearningConfigCard({
  machineLearning,
  onChange,
  hideHeader,
}: MachineLearningConfigCardProps) {
  const [form, setForm] = React.useState<AdminMachineLearningConfig>(() =>
    copyConfig(machineLearning)
  )
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    setForm(copyConfig(machineLearning))
  }, [machineLearning])

  const isDirty = !configsEqual(form, machineLearning)

  function setClassifier<
    K extends keyof AdminMachineLearningConfig["gameClassifier"],
  >(key: K, value: AdminMachineLearningConfig["gameClassifier"][K]) {
    setForm((current) => ({
      ...current,
      gameClassifier: {
        ...current.gameClassifier,
        [key]: value,
      },
    }))
  }

  function resetForm() {
    setForm(copyConfig(machineLearning))
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending || !isDirty) return

    const patch = normalizedConfig(form)
    setPending(true)
    try {
      const next = await api.admin.updateMachineLearningConfig(patch)
      onChange(next)
      toast.success("Machine learning updated")
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Couldn't update machine learning"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Section>
        {!hideHeader && (
          <SectionHeader>
            <SectionTitle>Machine learning</SectionTitle>
          </SectionHeader>
        )}
        <fieldset disabled={pending} className="contents">
          <SectionContent className="flex flex-col gap-0">
            <FormGroup>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    Upload game suggestions
                  </div>
                  <p className="mt-0.5 text-xs text-foreground-dim">
                    Use ML predictions in the clip upload game picker.
                  </p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(enabled) =>
                    setForm((current) => ({ ...current, enabled }))
                  }
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="ml-base-url" required>
                    Base URL
                  </FieldLabel>
                  <Input
                    id="ml-base-url"
                    type="url"
                    required
                    value={form.baseUrl}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        baseUrl: e.target.value,
                      }))
                    }
                  />
                  <FieldDescription>
                    Server-to-server URL for the Python ML service.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="ml-timeout" required>
                    Request timeout (ms)
                  </FieldLabel>
                  <Input
                    id="ml-timeout"
                    type="number"
                    min={1_000}
                    max={300_000}
                    step={1_000}
                    required
                    value={form.requestTimeoutMs}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        requestTimeoutMs: clampInt(
                          e.target.value,
                          1_000,
                          300_000,
                          current.requestTimeoutMs
                        ),
                      }))
                    }
                  />
                  <FieldDescription>
                    Upper bound for each inference request.
                  </FieldDescription>
                </Field>
              </div>
            </FormGroup>

            <FormGroup
              title="Game classifier"
              description="Model source used for upload suggestions."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="ml-repo-id" required>
                    Hugging Face repo
                  </FieldLabel>
                  <Input
                    id="ml-repo-id"
                    required
                    value={form.gameClassifier.repoId}
                    onChange={(e) => setClassifier("repoId", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="ml-filename" required>
                    Checkpoint file
                  </FieldLabel>
                  <Input
                    id="ml-filename"
                    required
                    value={form.gameClassifier.filename}
                    onChange={(e) => setClassifier("filename", e.target.value)}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="ml-revision" required>
                  Revision
                </FieldLabel>
                <Input
                  id="ml-revision"
                  required
                  value={form.gameClassifier.revision}
                  onChange={(e) => setClassifier("revision", e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="ml-checkpoint-path">
                  Local checkpoint
                </FieldLabel>
                <Input
                  id="ml-checkpoint-path"
                  value={form.gameClassifier.checkpointPath ?? ""}
                  onChange={(e) =>
                    setClassifier("checkpointPath", e.target.value)
                  }
                  placeholder="Blank uses Hugging Face"
                />
                <FieldDescription>
                  Path inside the ML service environment. Blank uses the repo
                  reference above.
                </FieldDescription>
              </Field>
            </FormGroup>
          </SectionContent>

          <SectionFooter>
            <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
              <Button
                className="flex-1 sm:flex-initial"
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetForm}
                disabled={pending || !isDirty}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 sm:flex-initial"
                type="submit"
                variant="primary"
                size="sm"
                disabled={pending || !isDirty}
              >
                <SaveIcon />
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </SectionFooter>
        </fieldset>
      </Section>
    </form>
  )
}
