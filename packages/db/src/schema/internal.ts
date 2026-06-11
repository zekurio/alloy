/** Render a string list into a SQL `in (...)` literal, escaping single quotes. */
export function sqlStringList(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ")
}
