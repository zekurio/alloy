import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import {
  isConstAssertion,
  isTypeAssertion,
  type TypeAssertion,
} from "../shared/expressions.ts"

function isForbiddenAssertionChain(node: TypeAssertion): boolean {
  let assertionCount = 0
  let hasNonConstAssertion = false
  let current: ESTree.Expression = node

  while (isTypeAssertion(current)) {
    assertionCount += 1
    hasNonConstAssertion ||= !isConstAssertion(current)
    current = current.expression
  }

  return assertionCount > 1 && hasNonConstAssertion
}

/** Disallow nested TypeScript type assertions, while permitting chains made only of const assertions. */
export const noChainedTypeAssertionsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow chained TypeScript as and angle-bracket assertions, including parenthesized chains.",
    },
    messages: {
      chained:
        "This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.",
    },
  },
  createOnce(context) {
    const checkTypeAssertion = (node: TypeAssertion) => {
      if (isTypeAssertion(node.parent) || !isForbiddenAssertionChain(node))
        return
      context.report({ node, messageId: "chained" })
    }

    return {
      TSAsExpression: checkTypeAssertion,
      TSTypeAssertion: checkTypeAssertion,
    }
  },
})
