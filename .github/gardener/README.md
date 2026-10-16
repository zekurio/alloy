# alloy-gardener

Repository upkeep powered by the Claude API, in the spirit of Helium's
`helium-gardener`. It runs from [`gardener.yml`](../workflows/gardener.yml)
and has no dependencies beyond Node 24.

| When                                   | What it does                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Issue opened                           | Labels kind, area and effort (`effort: XS`…`XL`); flags likely duplicates and missing repro details with a short comment.        |
| PR opened, reopened, ready             | Posts a review with inline comments and suggestions, checked against `AGENTS.md`, `CONTRIBUTING.md` and touched package READMEs. |
| Daily                                  | Locks closed issues and PRs with no activity for 30 days.                                                                        |
| `/gardener review`, `/gardener triage` | Re-runs on demand. Only owners, members and collaborators can trigger it.                                                        |

Reviews are always posted as `COMMENT`: the bot never approves or requests
changes. Drafts and bot-authored PRs (Dependabot) are skipped.

## Setup

1. Create an API key in the Claude Console organization that receives your
   plan's monthly API credits, so usage draws from that balance.
2. Add it as the repository secret `ANTHROPIC_API_KEY`.
3. Optionally try it without writing anything: run the **gardener** workflow
   manually with **dry run** checked.

### Posting as alloy-gardener

Without an app, comments come from `github-actions[bot]`. To post as
**alloy-gardener** with its own icon:

1. Create a GitHub App under **Settings → Developer settings → GitHub Apps**,
   named `alloy-gardener`, with the webhook disabled and these repository
   permissions: Issues read/write, Pull requests read/write, Contents read.
2. Upload its icon, the Alloy ingot outlined in `#d0c4eb` on `#0b0a0f`, and
   set the badge background color to `#0b0a0f`.
3. Generate a private key, then install the app on this repository only.
4. Add the app's Client ID as the repository **variable**
   `GARDENER_CLIENT_ID`, and the private key file's contents as the
   repository **secret** `GARDENER_PRIVATE_KEY`.

The workflow picks the app up automatically once the variable is set.

## Cost

Triage uses `claude-sonnet-5-5` and costs about a cent per issue. Reviews use
`claude-opus-5-5`: a typical PR is roughly $0.10–0.20, and diff and context
budgets cap the worst case near $0.40. Every run logs its token count and
estimated cost. Models, budgets, labels and lock timing live in
[`config.mjs`](config.mjs).

## Security

The workflow uses `pull_request_target` so fork PRs get reviewed, which means
it runs with secrets. It therefore only checks out the base branch; PR diffs
and file contents are read through the GitHub API as text and never executed.
The prompts tell the model to treat issue and PR text as untrusted data, and
the script only applies labels from its own list and only comments, so a
prompt injection can at worst produce a misleading comment.
