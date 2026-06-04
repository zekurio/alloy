import { RUNTIME_CONFIG_VERSION } from "@workspace/contracts";

export const CURRENT_RUNTIME_CONFIG_VERSION = RUNTIME_CONFIG_VERSION;

type JsonRecord = Record<string, unknown>;

export type RuntimeConfigMigrationResult =
  | { ok: true; config: unknown; migrated: boolean }
  | { ok: false; error: string };

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord(raw: unknown): JsonRecord | null {
  if (!isRecord(raw)) return null;
  return structuredClone(raw) as JsonRecord;
}

function readConfigVersion(config: JsonRecord): number {
  if (config.runtimeConfigVersion === undefined) return 0;
  if (
    typeof config.runtimeConfigVersion !== "number" ||
    !Number.isInteger(config.runtimeConfigVersion) ||
    config.runtimeConfigVersion < 0
  ) {
    return Number.NaN;
  }
  return config.runtimeConfigVersion;
}

/**
 * Runtime config migration entry point.
 *
 * When the schema next changes in a backward-incompatible way, bump
 * RUNTIME_CONFIG_VERSION and add the real upgrade step(s) here.
 */
export function migrateRuntimeConfig(
  raw: unknown,
): RuntimeConfigMigrationResult {
  const config = cloneRecord(raw);
  if (!config) {
    return { ok: false, error: "Runtime config must be a JSON object." };
  }

  const version = readConfigVersion(config);
  if (Number.isNaN(version)) {
    return {
      ok: false,
      error: "runtimeConfigVersion must be a non-negative integer.",
    };
  }
  if (version > CURRENT_RUNTIME_CONFIG_VERSION) {
    return {
      ok: false,
      error: `runtimeConfigVersion ${version} is newer than supported version ${CURRENT_RUNTIME_CONFIG_VERSION}.`,
    };
  }

  if (version === CURRENT_RUNTIME_CONFIG_VERSION) {
    return { ok: true, config, migrated: false };
  }

  config.runtimeConfigVersion = CURRENT_RUNTIME_CONFIG_VERSION;
  return { ok: true, config, migrated: true };
}
