import { defineRule } from "@oxlint/plugins"
import type { ESTree, SourceCode } from "@oxlint/plugins"

import {
  functionLikeVisitor,
  parameterAnnotation,
  type FunctionLike,
} from "../shared/functions.ts"
import { lexicalTypeParameterNames } from "../shared/lexical-type-parameters.ts"
import {
  createTypeEnvironment,
  referencedAliasName,
  type TypeEnvironment,
} from "../shared/type-environment.ts"

function parameterName(
  parameter: ESTree.ParamPattern,
  sourceCode: SourceCode,
): string {
  return parameter.type === "Identifier"
    ? parameter.name
    : sourceCode.getText(parameter).replace(/\s*:\s*object\s*$/u, "")
}

/** Ban the broad object type on function inputs, including local aliases to object. */
export const noObjectParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow object function parameters; inputs must use an owner-provided type and be parsed at their boundary.",
    },
    messages: {
      objectParameter:
        "Parameter `{{parameter}}` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.",
    },
  },
  createOnce(context) {
    let aliases: TypeEnvironment["aliases"] = new Map()

    const resolvesToObject = (
      type: ESTree.TSType,
      shadowedAliases: ReadonlySet<string>,
      visited = new Set<string>(),
    ): boolean => {
      if (type.type === "TSObjectKeyword") return true
      if (type.type === "TSUnionType") {
        return type.types.some((member) =>
          resolvesToObject(member, shadowedAliases, visited),
        )
      }
      const name = referencedAliasName(type)
      if (name === null || visited.has(name) || shadowedAliases.has(name))
        return false
      const alias = aliases.get(name)
      if (
        alias === undefined ||
        (alias.typeParameters !== null && alias.typeParameters !== undefined)
      ) {
        return false
      }
      const nextVisited = new Set(visited)
      nextVisited.add(name)
      return resolvesToObject(
        alias.typeAnnotation,
        shadowedAliases,
        nextVisited,
      )
    }

    const checkParameters = (node: FunctionLike) => {
      const shadowedAliases = lexicalTypeParameterNames(
        node,
        context.sourceCode.visitorKeys,
      )
      for (const parameter of node.params) {
        const annotation = parameterAnnotation(parameter)
        if (annotation === null || annotation === undefined) continue
        if (!resolvesToObject(annotation.typeAnnotation, shadowedAliases))
          continue
        context.report({
          node: annotation.typeAnnotation,
          messageId: "objectParameter",
          data: { parameter: parameterName(parameter, context.sourceCode) },
        })
      }
    }

    return {
      Program(node) {
        aliases = createTypeEnvironment(node).aliases
      },
      ...functionLikeVisitor(checkParameters),
    }
  },
})
