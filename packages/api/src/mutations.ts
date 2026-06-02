import { readJsonOrThrow, type JsonValidator } from "./http"
import { booleanFlagResponseValidator } from "./contract-validators"

type PostDeleteRequests = {
  post: () => Promise<Response>
  delete: () => Promise<Response>
}

export async function readPostDeleteJson<T>(
  next: boolean,
  requests: PostDeleteRequests,
  validate: JsonValidator<T>
): Promise<T> {
  const res = next ? await requests.post() : await requests.delete()
  return readJsonOrThrow(res, validate)
}

export function readBooleanFlagJson<T extends string>(
  res: Response,
  key: T
): Promise<Record<T, boolean>>
export function readBooleanFlagJson<T extends string, V extends boolean>(
  res: Response,
  key: T,
  expected: V
): Promise<Record<T, V>>
export function readBooleanFlagJson<T extends string>(
  res: Response,
  key: T,
  expected?: boolean
): Promise<Record<T, boolean>> {
  const validate =
    expected === undefined
      ? booleanFlagResponseValidator(key)
      : booleanFlagResponseValidator(key, expected)
  return readJsonOrThrow(res, validate)
}

export async function readSuccessJson(res: Response): Promise<void> {
  await readBooleanFlagJson(res, "success", true)
}

export async function readDeletedJson(res: Response): Promise<void> {
  await readBooleanFlagJson(res, "deleted", true)
}
