import type { ESTree } from "@oxlint/plugins"

export type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion

const knownValueKinds: ReadonlySet<string> = new Set([
  "ArrayExpression",
  "ArrowFunctionExpression",
  "ClassExpression",
  "FunctionExpression",
  "Literal",
  "NewExpression",
  "ObjectExpression",
  "TemplateLiteral",
  "UnaryExpression",
])

export function isTypeAssertion(node: ESTree.Node): node is TypeAssertion {
  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion"
}

export function isConstAssertion(node: TypeAssertion): boolean {
  const { typeAnnotation } = node
  return (
    typeAnnotation.type === "TSTypeReference" &&
    typeAnnotation.typeName.type === "Identifier" &&
    typeAnnotation.typeName.name === "const"
  )
}

/** Strip `as`, `satisfies`, `<T>`, and `!`, which change the static type but not the runtime value. */
export function unwrapTypeOnlyWrappers(
  expression: ESTree.Expression,
): ESTree.Expression {
  let current = expression
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression
  }
  return current
}

/** Literals, object and array literals, functions, classes, `new`, and unary operators: the syntax alone fixes the value's type. */
export function isKnownValueSyntax(expression: ESTree.Expression): boolean {
  return knownValueKinds.has(expression.type)
}

export function isEmptyObjectExpression(
  expression: ESTree.Expression,
): boolean {
  return (
    expression.type === "ObjectExpression" && expression.properties.length === 0
  )
}
