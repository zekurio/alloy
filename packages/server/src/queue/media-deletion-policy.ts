export function sameClipSourceIncarnation(
  expected: { authorId: string; sourceKey: string },
  current: { authorId: string; sourceKey: string | null },
): boolean {
  return (
    expected.authorId === current.authorId &&
    expected.sourceKey === current.sourceKey
  )
}
