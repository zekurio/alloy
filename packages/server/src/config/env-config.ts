import { readFileSync } from "node:fs"

import type { ContractJsonValue } from "@alloy/contracts"

import { mergeConfig, objectAtPath } from "./overrides"
import {
  configSection,
  type ConfigEnvSetting,
  type ConfigSectionName,
  type ConfigSectionValues,
} from "./sections"

type EnvSource = Record<string, string | undefined>

export interface ConfigEnv {
  /** Each section with its ALLOY_* variables applied over the built-ins. */
  defaults: ConfigSectionValues
  /** The variables that were set, for reporting the ones the UI overrides. */
  settings: { [Name in ConfigSectionName]: ConfigEnvSetting[] }
  oidcClientSecret: string | null
}

function envText(source: EnvSource, name: string): string | undefined {
  const value = source[name]?.trim()
  return value ? value : undefined
}

interface SectionEnv<Value> {
  value: Value
  settings: ConfigEnvSetting[]
}

function sectionDefaults<Name extends ConfigSectionName>(
  name: Name,
  source: EnvSource,
): SectionEnv<ConfigSectionValues[Name]> {
  const section = configSection(name)
  let input: ContractJsonValue = section.builtin
  const settings: ConfigEnvSetting[] = []
  for (const setting of section.env) {
    const raw = envText(source, setting.name)
    if (raw === undefined) continue
    let value: ContractJsonValue
    try {
      value = setting.parse(raw)
    } catch (cause) {
      throw new Error(
        `[server/env] Invalid ${setting.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      )
    }
    input = mergeConfig(input, objectAtPath(setting.path, value))
    settings.push(setting)
  }

  const parsed = section.schema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.map(String) ?? []
    // Rules that span fields report no path; name the section's variables.
    const owner = settings.find((setting) =>
      setting.path.every((key, index) => path[index] === key),
    )
    const label =
      owner && path.length > 0
        ? owner.name
        : settings.map((setting) => setting.name).join(", ")
    throw new Error(
      `[server/env] Invalid ${label}: ${issue?.message ?? "Invalid value"}`,
    )
  }
  return { value: parsed.data, settings }
}

function envSecret(source: EnvSource, name: string): string | null {
  const value = envText(source, name)
  const file = envText(source, `${name}_FILE`)
  if (value && file) {
    throw new Error(`[server/env] Set only one of ${name} and ${name}_FILE.`)
  }
  if (!file) return value ?? null

  let contents: string
  try {
    contents = readFileSync(file, "utf8").trim()
  } catch (cause) {
    throw new Error(
      `[server/env] ${name}_FILE could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
  if (!contents) throw new Error(`[server/env] ${name}_FILE is empty.`)
  return contents
}

export function parseConfigEnv(source: EnvSource): ConfigEnv {
  const auth = sectionDefaults("auth", source)
  const oidc = sectionDefaults("oidc", source)
  const appearance = sectionDefaults("appearance", source)
  const transcoding = sectionDefaults("transcoding", source)
  const uploadLimits = sectionDefaults("uploadLimits", source)
  const limits = sectionDefaults("limits", source)
  return {
    defaults: {
      auth: auth.value,
      oidc: oidc.value,
      appearance: appearance.value,
      transcoding: transcoding.value,
      uploadLimits: uploadLimits.value,
      limits: limits.value,
    },
    settings: {
      auth: auth.settings,
      oidc: oidc.settings,
      appearance: appearance.settings,
      transcoding: transcoding.settings,
      uploadLimits: uploadLimits.settings,
      limits: limits.settings,
    },
    oidcClientSecret: envSecret(source, "ALLOY_OIDC_CLIENT_SECRET"),
  }
}
