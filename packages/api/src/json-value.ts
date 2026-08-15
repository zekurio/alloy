export type ApiJsonInput = ReturnType<JSON["parse"]>

export type ApiJsonPrimitive = string | number | boolean | null | undefined

export type ApiJsonValue =
  | ApiJsonPrimitive
  | ApiJsonValue[]
  | { [key: string]: ApiJsonValue }
