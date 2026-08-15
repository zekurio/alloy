export type ContractJsonInput = ReturnType<JSON["parse"]>

export type ContractJsonPrimitive = string | number | boolean | null | undefined

export type ContractJsonValue =
  | ContractJsonPrimitive
  | ContractJsonValue[]
  | { [key: string]: ContractJsonValue }
