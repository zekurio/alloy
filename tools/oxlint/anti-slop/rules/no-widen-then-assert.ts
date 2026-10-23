import { defineRule } from "@oxlint/plugins"
import type { ESTree, Variable } from "@oxlint/plugins"

import {
  isKnownValueSyntax,
  isTypeAssertion,
  type TypeAssertion,
} from "../shared/expressions.ts"
import { typeReferenceName } from "../shared/type-environment.ts"
import {
  createVariableResolver,
  variableDeclarator,
  type VariableResolver,
} from "../shared/variables.ts"

type BroadTypeKind = "top" | "object" | "record"

type KnownValueEvidence = {
  readonly type: ESTree.TSType | null
}

const functionBoundaryTypes = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
])

function isUnknownOrAnyType(type: ESTree.TSType): boolean {
  return type.type === "TSUnknownKeyword" || type.type === "TSAnyKeyword"
}

function isBroadRecordKeyType(type: ESTree.TSType): boolean {
  if (
    type.type === "TSStringKeyword" ||
    type.type === "TSNumberKeyword" ||
    type.type === "TSSymbolKeyword"
  ) {
    return true
  }
  if (type.type === "TSUnionType") return type.types.every(isBroadRecordKeyType)
  return (
    type.type === "TSTypeReference" && typeReferenceName(type) === "PropertyKey"
  )
}

function isBroadRecordType(type: ESTree.TSType): boolean {
  if (type.type === "TSTypeReference") {
    if (typeReferenceName(type) === "Readonly") {
      const [inner] = type.typeArguments?.params ?? []
      return inner !== undefined && isBroadRecordType(inner)
    }

    if (typeReferenceName(type) !== "Record") return false
    const parameters = type.typeArguments?.params ?? []
    return (
      parameters.length === 2 &&
      parameters[0] !== undefined &&
      parameters[1] !== undefined &&
      isBroadRecordKeyType(parameters[0]) &&
      isUnknownOrAnyType(parameters[1])
    )
  }

  if (type.type !== "TSTypeLiteral" || type.members.length !== 1) return false
  const [member] = type.members
  const [parameter] =
    member?.type === "TSIndexSignature" ? member.parameters : []
  return (
    member?.type === "TSIndexSignature" &&
    member.parameters.length === 1 &&
    parameter !== undefined &&
    isBroadRecordKeyType(parameter.typeAnnotation.typeAnnotation) &&
    isUnknownOrAnyType(member.typeAnnotation.typeAnnotation)
  )
}

function broadTypeKind(type: ESTree.TSType): BroadTypeKind | null {
  if (type.type === "TSUnknownKeyword" || type.type === "TSAnyKeyword")
    return "top"
  if (type.type === "TSObjectKeyword") return "object"
  return isBroadRecordType(type) ? "record" : null
}

function normalizedTypeText(sourceText: string, type: ESTree.TSType): string {
  return sourceText.slice(type.start, type.end).replaceAll(/\s+/gu, "")
}

function typesHaveSameSyntax(
  sourceText: string,
  left: ESTree.TSType | null,
  right: ESTree.TSType,
): boolean {
  return (
    left !== null &&
    normalizedTypeText(sourceText, left) ===
      normalizedTypeText(sourceText, right)
  )
}

function isDefinitelyObjectType(type: ESTree.TSType): boolean {
  switch (type.type) {
    case "TSArrayType":
    case "TSConstructorType":
    case "TSFunctionType":
    case "TSMappedType":
    case "TSObjectKeyword":
    case "TSTupleType":
      return true
    case "TSTypeLiteral":
      return type.members.length > 0
    case "TSIntersectionType":
      return type.types.every(isDefinitelyObjectType)
    case "TSTypeOperator":
      return (
        type.operator === "readonly" &&
        isDefinitelyObjectType(type.typeAnnotation)
      )
    default:
      return false
  }
}

function isDefinitelyNarrowerRecordType(type: ESTree.TSType): boolean {
  if (type.type === "TSTypeLiteral") {
    return type.members.some((member) => member.type !== "TSIndexSignature")
  }

  if (type.type !== "TSTypeReference") return false
  if (typeReferenceName(type) === "Readonly") {
    const [inner] = type.typeArguments?.params ?? []
    return inner !== undefined && isDefinitelyNarrowerRecordType(inner)
  }
  if (typeReferenceName(type) !== "Record") return false

  const parameters = type.typeArguments?.params ?? []
  return (
    parameters.length === 2 &&
    parameters[1] !== undefined &&
    !isUnknownOrAnyType(parameters[1])
  )
}

function functionBoundary(node: ESTree.Node): ESTree.Node | null {
  let current = node.parent
  while (current !== null && current.type !== "Program") {
    if (functionBoundaryTypes.has(current.type)) return current
    current = current.parent
  }
  return null
}

function knownValueEvidence(
  expression: ESTree.Expression,
  resolveVariable: VariableResolver,
  boundary: ESTree.Node | null,
  visitedVariables: ReadonlySet<Variable>,
): KnownValueEvidence | null {
  if (isTypeAssertion(expression)) {
    if (broadTypeKind(expression.typeAnnotation) !== null) return null
    return { type: expression.typeAnnotation }
  }

  if (isKnownValueSyntax(expression)) return { type: null }

  if (expression.type !== "Identifier") return null
  const variable = resolveVariable(expression)
  if (variable === null || visitedVariables.has(variable)) return null

  const annotatedIdentifier = variable.identifiers.find(
    (identifier) =>
      identifier.typeAnnotation !== null &&
      identifier.typeAnnotation !== undefined,
  )
  const annotation = annotatedIdentifier?.typeAnnotation?.typeAnnotation
  if (annotation !== undefined && annotatedIdentifier !== undefined) {
    if (
      functionBoundary(annotatedIdentifier) !== boundary ||
      broadTypeKind(annotation) !== null
    ) {
      return null
    }
    return { type: annotation }
  }

  const declarator = variableDeclarator(variable)
  if (
    declarator === null ||
    declarator.parent.type !== "VariableDeclaration" ||
    declarator.parent.kind !== "const" ||
    declarator.init === null ||
    variable.references.some(
      (reference) => reference.isWrite() && !reference.init,
    ) ||
    functionBoundary(declarator) !== boundary
  ) {
    return null
  }

  return knownValueEvidence(
    declarator.init,
    resolveVariable,
    boundary,
    new Set([...visitedVariables, variable]),
  )
}

function widenedBinding(
  variable: Variable,
  resolveVariable: VariableResolver,
): {
  readonly broadKind: BroadTypeKind
  readonly evidence: KnownValueEvidence
  readonly declaredAt: number
  readonly boundary: ESTree.Node | null
} | null {
  const declarator = variableDeclarator(variable)
  if (
    declarator === null ||
    declarator.parent.type !== "VariableDeclaration" ||
    declarator.parent.kind !== "const" ||
    declarator.id.type !== "Identifier" ||
    declarator.init === null ||
    variable.references.some(
      (reference) => reference.isWrite() && !reference.init,
    )
  ) {
    return null
  }

  const boundary = functionBoundary(declarator)
  const declaredType = declarator.id.typeAnnotation?.typeAnnotation
  const initializerAssertion = isTypeAssertion(declarator.init)
    ? declarator.init
    : null
  const initializerBroadKind =
    initializerAssertion === null
      ? null
      : broadTypeKind(initializerAssertion.typeAnnotation)
  const declaredBroadKind =
    declaredType === undefined ? null : broadTypeKind(declaredType)
  const broadKind = declaredBroadKind ?? initializerBroadKind
  if (broadKind === null) return null

  const originalExpression =
    initializerAssertion !== null && initializerBroadKind !== null
      ? initializerAssertion.expression
      : declarator.init
  const evidence = knownValueEvidence(
    originalExpression,
    resolveVariable,
    boundary,
    new Set([variable]),
  )
  return evidence === null
    ? null
    : { broadKind, evidence, declaredAt: declarator.end, boundary }
}

function assertionIsNarrower(
  sourceText: string,
  broadKind: BroadTypeKind,
  evidence: KnownValueEvidence,
  assertedType: ESTree.TSType,
): boolean {
  if (broadTypeKind(assertedType) !== null) return false
  if (broadKind === "top") return true
  if (typesHaveSameSyntax(sourceText, evidence.type, assertedType)) return true
  if (broadKind === "object") return isDefinitelyObjectType(assertedType)
  return isDefinitelyNarrowerRecordType(assertedType)
}

/** Detect immutable local bindings that erase a known type and are later asserted back to a narrower type. */
export const noWidenThenAssertRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow local const flows that explicitly widen a known value before asserting the widened binding to a narrower type.",
    },
    messages: {
      widenThenAssert:
        'Binding "{{name}}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.',
    },
  },
  createOnce(context) {
    let resolveVariable: VariableResolver = () => null

    const checkAssertion = (node: TypeAssertion) => {
      const { expression } = node
      if (expression.type !== "Identifier") return

      const variable = resolveVariable(expression)
      if (variable === null) return
      const widened = widenedBinding(variable, resolveVariable)
      if (
        widened === null ||
        node.start <= widened.declaredAt ||
        functionBoundary(node) !== widened.boundary ||
        !assertionIsNarrower(
          context.sourceCode.text,
          widened.broadKind,
          widened.evidence,
          node.typeAnnotation,
        )
      ) {
        return
      }

      context.report({
        node,
        messageId: "widenThenAssert",
        data: { name: expression.name },
      })
    }

    return {
      Program() {
        resolveVariable = createVariableResolver(context.sourceCode)
      },
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    }
  },
})
