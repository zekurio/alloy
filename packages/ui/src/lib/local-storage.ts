interface LocalStorageDriver<Value> {
  read(): Value
  refresh(): Value
  write(value: Value): Value
}

type LocalStorageNormalizer<Value> = (value: unknown) => Value

/**
 * Treats one localStorage value as a small config file. Reads normalize in
 * memory and writes replace the whole value, matching the desktop preference
 * store's read-modify-write model.
 */
export function createLocalStorageDriver<Value>(
  key: string,
  normalize: LocalStorageNormalizer<Value>,
): LocalStorageDriver<Value> {
  let sessionValue: Value | null = null

  function storage(): Storage | null {
    try {
      return window.localStorage
    } catch {
      return null
    }
  }

  function read(): Value {
    if (sessionValue !== null) return sessionValue
    const currentStorage = storage()
    if (!currentStorage) return normalize(null)

    try {
      const stored = currentStorage.getItem(key)
      return normalize(stored === null ? null : JSON.parse(stored))
    } catch {
      return normalize(null)
    }
  }

  function refresh(): Value {
    sessionValue = null
    return read()
  }

  function write(value: Value): Value {
    const normalized = normalize(value)
    const currentStorage = storage()
    if (!currentStorage) {
      sessionValue = normalized
      return normalized
    }

    try {
      currentStorage.setItem(key, JSON.stringify(normalized))
      sessionValue = null
    } catch {
      sessionValue = normalized
    }
    return normalized
  }

  return { read, refresh, write }
}
