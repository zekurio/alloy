import type { ESTree, Reference, SourceCode, Variable } from "@oxlint/plugins"

export type VariableResolver = (
  identifier: ESTree.IdentifierReference,
) => Variable | null

/**
 * Resolve identifiers through the file's scope references rather than by
 * name, so a same-named type in a closer scope cannot capture a value
 * reference. The index is built on first use.
 */
export function createVariableResolver(
  sourceCode: SourceCode,
): VariableResolver {
  let references: ReadonlyMap<ESTree.Node, Reference> | null = null
  return (identifier) => {
    if (references === null) {
      const index = new Map<ESTree.Node, Reference>()
      for (const scope of sourceCode.scopeManager.scopes) {
        for (const reference of scope.references) {
          index.set(reference.identifier, reference)
        }
      }
      references = index
    }
    return references.get(identifier)?.resolved ?? null
  }
}

/** Return the declarator of a variable's single `Variable` definition; same-named type declarations do not count. */
export function variableDeclarator(
  variable: Variable,
): ESTree.VariableDeclarator | null {
  const declarators = variable.defs.flatMap((definition) =>
    definition.type === "Variable" &&
    definition.node.type === "VariableDeclarator"
      ? [definition.node]
      : [],
  )
  return declarators.length === 1 ? declarators[0] : null
}
