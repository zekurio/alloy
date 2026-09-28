import { parse } from "@babel/parser"
import {
  isCallExpression,
  isConditionalExpression,
  isIdentifier,
  isImportDeclaration,
  isImportNamespaceSpecifier,
  isImportSpecifier,
  isMemberExpression,
  isStringLiteral,
  isTemplateLiteral,
  traverseFast,
  type Node,
} from "@babel/types"

export interface SourceMessage {
  key: string
  line: number
}

export interface SourceMessages {
  messages: SourceMessage[]
  errors: string[]
}

/** Read translation calls, not comments, import paths, or unrelated strings. */
export function extractSourceMessages(
  source: string,
  filename: string,
): SourceMessages {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    sourceFilename: filename,
  })
  const imports = new Map<string, string>()
  const namespaces = new Set<string>()
  const result: SourceMessages = { messages: [], errors: [] }

  for (const node of ast.program.body) {
    if (!isImportDeclaration(node) || node.source.value !== "@alloy/i18n")
      continue
    for (const specifier of node.specifiers) {
      if (isImportSpecifier(specifier)) {
        imports.set(
          specifier.local.name,
          isIdentifier(specifier.imported)
            ? specifier.imported.name
            : specifier.imported.value,
        )
      } else if (isImportNamespaceSpecifier(specifier)) {
        namespaces.add(specifier.local.name)
      }
    }
  }

  function add(node: Node | undefined, required = false): string[] {
    if (!node) return []
    const line = node.loc?.start.line ?? 1
    if (isStringLiteral(node)) {
      result.messages.push({ key: node.value, line })
      return [node.value]
    }
    if (isTemplateLiteral(node) && node.expressions.length === 0) {
      const key = node.quasis[0].value.cooked ?? node.quasis[0].value.raw
      result.messages.push({ key, line })
      return [key]
    }
    if (isConditionalExpression(node)) {
      return [
        ...add(node.consequent, required),
        ...add(node.alternate, required),
      ]
    }
    if (required || isTemplateLiteral(node)) {
      result.errors.push(
        `${filename}:${line}: Use a literal message with {placeholders}, not a computed translation key.`,
      )
    }
    // Runtime errors can be arbitrary strings. Their known keys live in the
    // catalogs; deferred application-owned messages must use message("...").
    return []
  }

  traverseFast(ast, (node) => {
    if (!isCallExpression(node)) return
    const callee = node.callee
    let name: string | undefined
    if (isIdentifier(callee)) {
      name = imports.get(callee.name)
    } else if (
      isMemberExpression(callee) &&
      !callee.computed &&
      isIdentifier(callee.object) &&
      namespaces.has(callee.object.name) &&
      isIdentifier(callee.property)
    ) {
      name = callee.property.name
    }
    if (name === "t" || name === "message") {
      add(node.arguments[0], name === "message")
    } else if (name === "translate") {
      add(node.arguments[1])
    } else if (name === "tp" || name === "translatePlural") {
      const index = name === "tp" ? 1 : 2
      const singular = add(node.arguments[index])
      const other = node.arguments[index + 1]
      if (other && !(isIdentifier(other) && other.name === "undefined")) {
        add(other)
      } else {
        for (const key of singular) {
          result.messages.push({
            key: `${key}s`,
            line: node.loc?.start.line ?? 1,
          })
        }
      }
    }
  })
  return result
}
