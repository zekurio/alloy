/**
 * Emits `src/lib/theme-variables.ts` from the custom properties declared in
 * `src/styles/globals.css`. The manifest is what the theme editor renders and
 * what `var(` autocomplete completes against, so generating it means the editor
 * can never offer a token the stylesheet no longer defines.
 *
 * Run with `pnpm --filter @alloy/ui theme:variables`.
 */
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE = join(root, "src/styles/globals.css")
const OUTPUT = join(root, "src/lib/theme-variables.ts")

/**
 * Ordered longest-prefix-first: `--foreground-muted` has to match the text
 * group before `--foreground` would, and `--sidebar-rail` is layout while the
 * rest of `--sidebar-*` is a surface.
 */
const GROUP_RULES: {
  id: string
  label: string
  match: (name: string) => boolean
}[] = [
  {
    id: "typography",
    label: "Typography",
    match: (name) => name.startsWith("--font-"),
  },
  {
    id: "layout",
    label: "Layout",
    match: (name) =>
      name === "--sidebar-rail" ||
      name.startsWith("--header-") ||
      name.startsWith("--bottomnav-"),
  },
  {
    id: "brand",
    label: "Brand & accents",
    match: (name) =>
      name.startsWith("--accent") ||
      name.startsWith("--primary") ||
      name.startsWith("--brand-"),
  },
  {
    id: "text",
    label: "Text",
    match: (name) => name.startsWith("--foreground"),
  },
  {
    id: "borders",
    label: "Borders & focus",
    match: (name) => name.startsWith("--border") || name === "--ring",
  },
  {
    id: "status",
    label: "Status",
    match: (name) =>
      [
        "--success",
        "--warning",
        "--danger",
        "--info",
        "--live",
        "--destructive",
      ].includes(name),
  },
  {
    id: "surfaces",
    label: "Surfaces",
    match: (name) =>
      name === "--background" ||
      name === "--input" ||
      name.startsWith("--surface") ||
      name.startsWith("--card") ||
      name.startsWith("--popover") ||
      name.startsWith("--muted") ||
      name.startsWith("--secondary") ||
      name.startsWith("--sidebar"),
  },
  {
    id: "neutrals",
    label: "Neutral scale",
    match: (name) => name.startsWith("--neutral-"),
  },
  {
    id: "radius",
    label: "Corner radius",
    match: (name) => name.startsWith("--radius"),
  },
  {
    id: "spacing",
    label: "Spacing",
    match: (name) => name.startsWith("--space-"),
  },
  {
    id: "motion",
    label: "Motion",
    match: (name) =>
      name.startsWith("--ease-") || name.startsWith("--duration-"),
  },
  {
    id: "shadows",
    label: "Shadows",
    match: (name) => name.startsWith("--shadow-"),
  },
]

const FALLBACK_GROUP = {
  id: "other",
  label: "Other",
  groupIndex: GROUP_RULES.length,
}

type ThemeVariableKind =
  | "color"
  | "font"
  | "dimension"
  | "number"
  | "shadow"
  | "transition"
  | "other"

function classifyKind(name: string, value: string): ThemeVariableKind {
  if (name.startsWith("--font-")) return "font"
  if (name.startsWith("--shadow-")) return "shadow"
  if (name.startsWith("--ease-") || name.startsWith("--duration-")) {
    return "transition"
  }
  if (
    /^(oklch|rgba?|hsla?|color-mix)\(/.test(value) ||
    /^#[0-9a-f]{3,8}$/i.test(value)
  ) {
    return "color"
  }
  // A token defined as `var(--other)` inherits the kind of what it points at,
  // which the second pass below resolves.
  if (/^-?[\d.]+(px|rem|em|%|vh|vw)$/.test(value)) return "dimension"
  if (/^-?[\d.]+$/.test(value)) return "number"
  return "other"
}

/**
 * A human label for the editor: `--foreground-muted` reads as "foreground
 * muted", matching how the tokens are talked about in review.
 */
function humanLabel(name: string): string {
  return name.replace(/^--/, "").replace(/-/g, " ")
}

async function main() {
  const css = await readFile(SOURCE, "utf8")

  // Only the base `:root, .dark` block defines the full token set; the light
  // and [data-neutral] blocks restate a subset and would produce duplicates.
  const block = css.match(/:root,\s*\.dark\s*\{([\s\S]*?)\n\}/)
  if (!block?.[1]) {
    throw new Error(`No ":root, .dark" block found in ${SOURCE}`)
  }

  const declarations = [
    ...block[1].matchAll(/^\s*(--[\w-]+)\s*:\s*([\s\S]*?);$/gm),
  ]
  const seen = new Set<string>()
  const variables = declarations.flatMap(([, name, rawValue]) => {
    if (!name || !rawValue || seen.has(name)) return []
    seen.add(name)
    const value = rawValue.replace(/\s+/g, " ").trim()
    const rule = GROUP_RULES.find((candidate) => candidate.match(name))
    return [
      {
        name,
        label: humanLabel(name),
        value,
        kind: classifyKind(name, value),
        groupId: rule?.id ?? FALLBACK_GROUP.id,
        groupLabel: rule?.label ?? FALLBACK_GROUP.label,
        groupIndex: rule
          ? GROUP_RULES.indexOf(rule)
          : FALLBACK_GROUP.groupIndex,
      },
    ]
  })

  // `--background: var(--neutral-0)` is a colour even though its literal value
  // is a var() reference, so resolve aliases once every token is known.
  const byName = new Map(variables.map((variable) => [variable.name, variable]))
  for (const variable of variables) {
    if (variable.kind !== "other") continue
    const alias = variable.value.match(/^var\((--[\w-]+)\)$/)
    const target = alias?.[1] ? byName.get(alias[1]) : undefined
    if (target) variable.kind = target.kind
  }

  variables.sort(
    (a, b) => a.groupIndex - b.groupIndex || a.name.localeCompare(b.name),
  )

  const groups = GROUP_RULES.concat(
    variables.some((variable) => variable.groupId === FALLBACK_GROUP.id)
      ? [{ ...FALLBACK_GROUP, match: () => false }]
      : [],
  ).filter((group) =>
    variables.some((variable) => variable.groupId === group.id),
  )

  const file = `// Generated by scripts/generate-theme-variables.ts. Do not edit by hand.
// Run \`pnpm --filter @alloy/ui theme:variables\` after changing globals.css.

export type ThemeVariableKind =
  | "color"
  | "font"
  | "dimension"
  | "number"
  | "shadow"
  | "transition"
  | "other"

export interface ThemeVariable {
  /** Custom property name, including the leading \`--\`. */
  name: string
  /** Editor label, e.g. "foreground muted". */
  label: string
  /** Value declared in the base \`:root, .dark\` block. */
  defaultValue: string
  kind: ThemeVariableKind
  groupId: string
}

export interface ThemeVariableGroup {
  id: string
  label: string
}

export const THEME_VARIABLE_GROUPS: readonly ThemeVariableGroup[] = [
${groups.map((group) => `  { id: ${JSON.stringify(group.id)}, label: ${JSON.stringify(group.label)} },`).join("\n")}
]

export const THEME_VARIABLES: readonly ThemeVariable[] = [
${variables
  .map(
    (variable) =>
      `  {\n    name: ${JSON.stringify(variable.name)},\n    label: ${JSON.stringify(variable.label)},\n    defaultValue: ${JSON.stringify(variable.value)},\n    kind: ${JSON.stringify(variable.kind)},\n    groupId: ${JSON.stringify(variable.groupId)},\n  },`,
  )
  .join("\n")}
]

export const THEME_VARIABLES_BY_NAME: ReadonlyMap<string, ThemeVariable> =
  new Map(THEME_VARIABLES.map((variable) => [variable.name, variable]))
`

  await writeFile(OUTPUT, file, "utf8")
  process.stdout.write(
    `theme-variables: ${variables.length} tokens in ${groups.length} groups\n`,
  )
}

await main()
