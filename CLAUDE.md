@AGENTS.md

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI has
really generous limits), not list price. Intelligence is how hard a problem
you can hand the model unsupervised. Taste covers UI/UX, code quality,
API design, and copy.

| model    | cost | intelligence | taste |
| -------- | ---- | ------------ | ----- |
| gpt-5.5  | 10   | 8            | 5     |
| sonnet-5 | 6    | 5            | 7     |
| opus-4.8 | 4    | 8            | 8     |
| fable-5  | 2    | 9            | 9     |

Cost notes:

- gpt-5.5 is effectively free at my limits. When intelligence ≤ 8 suffices
  and taste doesn't matter, there is no cost reason to ever use anything else.
- fable-5's cost of 2 applies to _subagent_ use. Main-session fable doing
  implementation work is even worse: it burns the orchestrator's context and
  my scarcest quota simultaneously. Treat it as cost 0.
- Cost ordering: for internal/mechanical work, cost is a primary axis —
  route down to the cheapest model that clears the intelligence bar.
  For anything that ships, intelligence > taste > cost, and escalating is
  always cheaper than shipping mediocre work.

How to apply:

- These are defaults, not limits. You have standing permission to override
  them: if a cheaper model's output doesn't meet the bar, rerun or redo the
  work with a smarter model without asking. Judge the output, not the
  price tag.
- Anything user-facing (UI, copy, API design) needs taste ≥ 7.
- Never use Haiku.

## Delegation policy

You (the main session, fable-5) are an orchestrator. Your job is decomposing
tasks, routing them to subagents, and reviewing results — not implementing.
Main-session fable is the most expensive resource in this setup; every token
you spend writing code yourself is the worst-value option available.

Default: DELEGATE. If a task can be specified in a self-contained paragraph,
it must go to a subagent. Do work yourself only when it's (a) trivial
(< ~20 lines, single file), (b) pure conversation/planning with me, or
(c) final review synthesis.

Routing (task type → executor):

- Bulk/mechanical (clear-spec implementation, migrations, data analysis,
  investigation): gpt-5.5 via codex — it's near-free and very technical.
- User-facing work (UI, copy, API design): sonnet-5 subagent minimum;
  opus-4.8 if it ships.
- Plan/implementation reviews: fable-5 or opus-4.8 subagent, optionally
  gpt-5.5 as an extra independent perspective.
- Claude models (sonnet-5, opus-4.8, fable-5) run via the Agent/Workflow
  model parameter.

## Codex mechanics (gpt-5.5)

gpt-5.5 is handled via the `openai/codex-plugin-cc` plugin, automatically
adopting user-level configuration from `~/.codex/config.toml`. Avoid writing
custom bash scripts; use the plugin's built-in tools and skills:

- `/codex:review` — Non-destructive, read-only code quality assessments.
  Supports `--base <ref>` for branch analysis.
- `/codex:adversarial-review` — Skeptical design review to pressure-test
  tradeoffs, auth, and reliability. Append custom focus text at the end of
  the command to steer the focus.
- `/codex:rescue` — Subcontract active debugging, multi-file refactoring,
  or implementation loops to Codex when a second pass is required.
- `/codex:status` / `/codex:result` / `/codex:cancel` — Check, fetch, or
  abort asynchronous jobs when using the `--background` flag on heavy tasks.

Invoking gpt-5.5 from workflows and subagents (the Agent model parameter
only takes Claude models, so never spawn fable or opus just to call the
plugin):

- Spawn a thin wrapper agent with `model: sonnet` (lowest effort) whose
  entire job is: write a self-contained codex prompt from your task spec,
  invoke the plugin's `codex-cli-runtime` skill, and return the result
  verbatim.
- The wrapper adds no judgment of its own. Judgment stays with you
  (routing, review) and with gpt-5.5 (execution).
- For heavy tasks use `--background` and poll with `/codex:status` /
  `/codex:result` so the main session stays free for orchestration.
- Keep the review gate on (`/codex:setup --enable-review-gate`) so a stop
  hook challenges outputs via Codex before they reach the main session
  unvetted.

## Anti-patterns (never do these)

- Implementing multi-file changes directly in the main session.
- Spawning a fable-5 or opus-4.8 subagent whose only job is calling codex —
  that's what the sonnet wrapper is for.
- Skipping delegation "to save time." Delegation and escalation are both
  cheaper than main-session tokens or shipping mediocre work.
- Using Haiku for anything.
