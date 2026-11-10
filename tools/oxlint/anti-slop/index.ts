import { eslintCompatPlugin } from "@oxlint/plugins"

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts"
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts"
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts"
import { noObjectParametersRule } from "./rules/no-object-parameters.ts"
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts"
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts"
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts"

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-known-value-widening": noKnownValueWideningRule,
    "no-object-parameters": noObjectParametersRule,
    "no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
    "no-widen-then-assert": noWidenThenAssertRule,
    "require-safety-comment-for-type-assertion":
      requireSafetyCommentForTypeAssertionRule,
  },
})

export default antiSlopPlugin
