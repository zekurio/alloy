import { defineRule } from "@oxlint/plugins"
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins"

import {
  isEmptyObjectExpression,
  isKnownValueSyntax,
  isTypeAssertion,
  unwrapTypeOnlyWrappers,
} from "../shared/expressions.ts"
import {
  createTypeEnvironment,
  type TypeEnvironment,
} from "../shared/type-environment.ts"
import {
  createVariableResolver,
  variableDeclarator,
  type VariableResolver,
} from "../shared/variables.ts"
import {
  classifyWideningTarget,
  type WideningTarget,
} from "../shared/widening-targets.ts"

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function

function isStableConstVariable(
  variable: Variable,
  declarator: ESTree.VariableDeclarator,
): boolean {
  return (
    declarator.parent.type === "VariableDeclaration" &&
    declarator.parent.kind === "const" &&
    variable.references.every(
      (reference) => reference.init || !reference.isWrite(),
    )
  )
}

function hasKnownEvidence(
  resolveVariable: VariableResolver,
  expression: ESTree.Expression,
  visitedVariables = new Set<Variable>(),
): boolean {
  const unwrapped = unwrapTypeOnlyWrappers(expression)
  if (isKnownValueSyntax(unwrapped)) return true
  if (unwrapped.type !== "Identifier") return false
  const variable = resolveVariable(unwrapped)
  if (variable === null || visitedVariables.has(variable)) return false
  const declarator = variableDeclarator(variable)
  if (
    declarator === null ||
    declarator.init === null ||
    !isStableConstVariable(variable, declarator)
  ) {
    return false
  }
  visitedVariables.add(variable)
  return hasKnownEvidence(resolveVariable, declarator.init, visitedVariables)
}

function annotationTarget(
  annotation: ESTree.TSTypeAnnotation | null | undefined,
  environment: TypeEnvironment,
): WideningTarget | null {
  return annotation === null || annotation === undefined
    ? null
    : classifyWideningTarget(annotation.typeAnnotation, environment)
}

function enclosingFunction(node: ESTree.Node): FunctionExpression | null {
  let current: ESTree.Node | null = node.parent
  while (current !== null && current.type !== "Program") {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression"
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

function sourceKeyName(
  sourceCode: SourceCode,
  key: ESTree.PropertyKey,
): string {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier")
    return key.name
  if (key.type === "Literal") return String(key.value)
  return sourceCode.getText(key)
}

function functionName(
  sourceCode: SourceCode,
  owner: FunctionExpression | null,
): string {
  if (owner === null) return "anonymous function"
  if (owner.id !== null) return owner.id.name
  const parent = owner.parent
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name
  if (parent.type === "MethodDefinition")
    return sourceKeyName(sourceCode, parent.key)
  return "anonymous function"
}

function isDictionaryAccumulatorTarget(destination: WideningTarget): boolean {
  return (
    destination.kind === "open dictionary" ||
    destination.kind === "generic container"
  )
}

/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
export const noKnownValueWideningRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence.",
    },
    messages: {
      widening:
        "The explicit {{target}} type on {{subject}} discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.",
    },
  },
  createOnce(context) {
    let environment: TypeEnvironment | null = null
    let resolveVariable: VariableResolver = () => null

    const reportFlow = (
      expression: ESTree.Expression,
      destination: WideningTarget | null,
      subject: string,
    ) => {
      if (destination === null) return
      if (
        isDictionaryAccumulatorTarget(destination) &&
        isEmptyObjectExpression(unwrapTypeOnlyWrappers(expression))
      ) {
        return
      }
      if (!hasKnownEvidence(resolveVariable, expression)) return
      context.report({
        node: expression,
        messageId: "widening",
        data: { subject, target: destination.kind },
      })
    }

    const targetFromAnnotation = (
      annotation: ESTree.TSTypeAnnotation | null | undefined,
    ) =>
      environment === null ? null : annotationTarget(annotation, environment)

    return {
      Program(node) {
        environment = createTypeEnvironment(node)
        resolveVariable = createVariableResolver(context.sourceCode)
      },
      VariableDeclarator(node) {
        if (node.init === null || node.id.type !== "Identifier") return
        reportFlow(
          node.init,
          targetFromAnnotation(node.id.typeAnnotation),
          `binding \`${node.id.name}\``,
        )
      },
      PropertyDefinition(node) {
        if (node.value === null) return
        reportFlow(
          node.value,
          targetFromAnnotation(node.typeAnnotation),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``,
        )
      },
      AccessorProperty(node) {
        if (node.value === null) return
        reportFlow(
          node.value,
          targetFromAnnotation(node.typeAnnotation),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``,
        )
      },
      AssignmentExpression(node) {
        if (node.operator !== "=" || node.left.type !== "Identifier") return
        const variable = resolveVariable(node.left)
        if (variable === null) return
        const declarator = variableDeclarator(variable)
        if (declarator === null || declarator.id.type !== "Identifier") return
        reportFlow(
          node.right,
          targetFromAnnotation(declarator.id.typeAnnotation),
          `binding \`${declarator.id.name}\``,
        )
      },
      ReturnStatement(node) {
        if (node.argument === null) return
        const owner = enclosingFunction(node)
        reportFlow(
          node.argument,
          targetFromAnnotation(owner?.returnType),
          `return value of \`${functionName(context.sourceCode, owner)}\``,
        )
      },
      ArrowFunctionExpression(node) {
        if (node.body.type === "BlockStatement") return
        reportFlow(
          node.body,
          targetFromAnnotation(node.returnType),
          `return value of \`${functionName(context.sourceCode, node)}\``,
        )
      },
      TSAsExpression(node) {
        if (environment === null || isTypeAssertion(node.parent)) return
        reportFlow(
          node.expression,
          classifyWideningTarget(node.typeAnnotation, environment),
          "assertion",
        )
      },
      TSTypeAssertion(node) {
        if (environment === null || isTypeAssertion(node.parent)) return
        reportFlow(
          node.expression,
          classifyWideningTarget(node.typeAnnotation, environment),
          "assertion",
        )
      },
    }
  },
})
