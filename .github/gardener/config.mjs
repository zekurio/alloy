// Tunables for alloy-gardener. Labels listed here are owned by the gardener:
// on re-triage it replaces them, and leaves every other label untouched.

export const config = {
  models: {
    triage: "claude-sonnet-5-5",
    review: "claude-opus-5-5",
  },

  // USD per million tokens, only used for the cost line in workflow logs.
  pricePerMTok: {
    "claude-opus-5-5": { input: 4, output: 20 },
    "claude-sonnet-5-5": { input: 2, output: 10 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  },

  // Model-facing area key -> label. Mirrors the issue template dropdowns.
  areas: {
    desktop: "area: desktop",
    recorder: "area: recorder",
    server: "area: server",
    web: "area: web",
    upload: "area: upload pipeline",
    packaging: "area: packaging",
    docs: "area: docs",
    accessibility: "area: accessibility",
    maintenance: "area: maintenance",
  },

  kinds: {
    bug: "bug",
    feature: "nice to have",
    question: "question",
    other: null,
  },

  labels: {
    bug: { color: "d73a4a", description: "Something isn't working" },
    "nice to have": { color: "a2eeef", description: "Feature request" },
    question: { color: "d876e3", description: "Question or support request" },

    "area: desktop": { color: "1d76db", description: "Tauri desktop app" },
    "area: recorder": {
      color: "1d76db",
      description: "OBS recorder and clip capture",
    },
    "area: server": { color: "1d76db", description: "Hono server and API" },
    "area: web": { color: "1d76db", description: "React web app" },
    "area: upload pipeline": {
      color: "1d76db",
      description: "Upload and encoding pipeline",
    },
    "area: packaging": {
      color: "1d76db",
      description: "Packaging, Nix, releases",
    },
    "area: docs": { color: "1d76db", description: "Documentation" },
    "area: accessibility": { color: "1d76db", description: "Accessibility" },
    "area: maintenance": {
      color: "1d76db",
      description: "Maintenance and technical debt",
    },

    "effort: XS": { color: "c2e0c6", description: "Under an hour" },
    "effort: S": { color: "bfdadc", description: "About an afternoon" },
    "effort: M": { color: "fef2c0", description: "One to three days" },
    "effort: L": { color: "f9d0c4", description: "About a week" },
    "effort: XL": {
      color: "e99695",
      description: "Multi-week or architectural",
    },

    "needs info": {
      color: "fbca04",
      description: "Waiting on details from the reporter",
    },
    "possible duplicate": {
      color: "cfd3d7",
      description: "May duplicate an existing issue",
    },
  },

  review: {
    // Generated or vendored files that aren't worth model tokens.
    ignore: [
      /(^|\/)pnpm-lock\.yaml$/,
      /(^|\/)Cargo\.lock$/,
      /(^|\/)flake\.lock$/,
      /(^|\/)devenv\.lock$/,
      /(^|\/)dist\//,
      /\.snap$/,
      /\.(png|jpe?g|gif|webp|ico|icns|svg|woff2?|ttf|mp4|webm)$/i,
      /(^|\/)drizzle\/meta\//,
    ],
    // ~4 chars per token: 160k + 240k chars ≈ 100k tokens ≈ $0.40 on Opus, worst case.
    maxDiffChars: 160_000,
    maxContextChars: 240_000,
    maxFileBytes: 60_000,
    maxFindings: 15,
  },

  lock: {
    afterDays: 30,
    maxPerRun: 50,
  },
}
