import type { ESTree } from "@oxlint/plugins"

/** Nodes that declare parameters and an optional return type, from runtime functions to type-level signatures. */
export type FunctionLike =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature

/** Run one check on every function-like node, including overload and ambient declarations. */
export function functionLikeVisitor(check: (node: FunctionLike) => void) {
  return {
    ArrowFunctionExpression: check,
    FunctionDeclaration: check,
    FunctionExpression: check,
    TSCallSignatureDeclaration: check,
    TSConstructSignatureDeclaration: check,
    TSConstructorType: check,
    TSDeclareFunction: check,
    TSEmptyBodyFunctionExpression: check,
    TSFunctionType: check,
    TSMethodSignature: check,
  }
}

export function parameterAnnotation(
  parameter: ESTree.ParamPattern,
): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") {
    return parameterAnnotation(parameter.parameter)
  }
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument)
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation
  }
  return parameter.typeAnnotation
}
