type FlagDefinition = {
  env: string
  defaultValue?: boolean
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"])

const devFlagDefinitions = {
  forceOnboarding: {
    env: "VITE_DEV_FORCE_ONBOARDING",
  },
} as const satisfies Record<string, FlagDefinition>

const featureFlagDefinitions = {} as const satisfies Record<
  string,
  FlagDefinition
>

export type DevFlagName = keyof typeof devFlagDefinitions
export type FeatureFlagName = keyof typeof featureFlagDefinitions

function flagEnvValue(name: string): string | undefined {
  if (typeof window !== "undefined") {
    const value = import.meta.env[name]
    return typeof value === "string" ? value : undefined
  }

  return process.env[name]
}

function readBooleanFlag(definition: FlagDefinition): boolean {
  const value = flagEnvValue(definition.env)
  if (value !== undefined) return TRUE_VALUES.has(value.trim().toLowerCase())

  return definition.defaultValue ?? false
}

function readFlagGroup<T extends Record<string, FlagDefinition>>(
  definitions: T
): { readonly [K in keyof T]: boolean } {
  return Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      readBooleanFlag(definition),
    ])
  ) as { readonly [K in keyof T]: boolean }
}

export const devFlags = readFlagGroup(devFlagDefinitions)
export const featureFlags = readFlagGroup(featureFlagDefinitions)

export function isDevFlagEnabled(name: DevFlagName): boolean {
  return devFlags[name]
}

export function isFeatureFlagEnabled(name: FeatureFlagName): boolean {
  return featureFlags[name]
}
