import type { ESTree } from "@oxlint/plugins"

type VisitorKeys = Readonly<Record<string, readonly string[]>>
/** A visitor-key property holds one child node, a list of optional children, or nothing. */
type ChildSlot = ESTree.Node | (ESTree.Node | null)[] | null | undefined

function childNodes(slot: ChildSlot): readonly ESTree.Node[] {
  if (slot === null || slot === undefined) return []
  if (Array.isArray(slot)) return slot.filter((child) => child !== null)
  return [slot]
}

function collectInferTypeParameterNames(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
  names: Set<string>,
): void {
  if (node.type === "TSInferType") names.add(node.typeParameter.name.name)
  const keys = visitorKeys[node.type] ?? []
  for (const [key, slot] of Object.entries(node)) {
    if (!keys.includes(key)) continue
    for (const child of childNodes(slot)) {
      collectInferTypeParameterNames(child, visitorKeys, names)
    }
  }
}

/** Collect type binders that are in scope at a node and can shadow module aliases. */
export function lexicalTypeParameterNames(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
): ReadonlySet<string> {
  const names = new Set<string>()
  let descendant: ESTree.Node = node
  let current: ESTree.Node | null = node
  while (current !== null && current.type !== "Program") {
    if ("typeParameters" in current) {
      for (const parameter of current.typeParameters?.params ?? []) {
        names.add(parameter.name.name)
      }
    }
    if (
      current.type === "TSMappedType" &&
      (descendant === current.nameType || descendant === current.typeAnnotation)
    ) {
      names.add(current.key.name)
    }
    if (
      current.type === "TSConditionalType" &&
      descendant === current.trueType
    ) {
      collectInferTypeParameterNames(current.extendsType, visitorKeys, names)
    }
    descendant = current
    current = current.parent
  }
  return names
}
