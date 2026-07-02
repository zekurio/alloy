@AGENTS.md

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI has really generous limits), not list price. Intelligence is how hard a problem you can hand the model unsupervised. Coding is sheer coding capability (based on Deep SWE). UI taste covers UI/UX, visual design, API ergonomics, and copy.

| model    | cost | intelligence | coding | ui taste |
| -------- | ---- | ------------ | ------ | -------- |
| gpt-5.5  | 9    | 8            | 7      | 5        |
| sonnet-5 | 5    | 5            | 4      | 7        |
| opus-4.8 | 4    | 7            | 6      | 8        |
| fable-5  | 2    | 9            | 9      | 9        |

How to apply:

- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence > coding > ui taste > cost. For user-facing work, ui taste outranks coding.
- Bulk/mechanical work (clear-spec implementation, data analysis, migrations): gpt-5.5 - it's effectively free.
- Anything user-facing (UI, copy, API design) needs ui taste >= 7 - never gpt-5.5.
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally gpt-5.5 as an extra independent perspective.
- Never use Haiku.
- Mechanics: gpt-5.5 is only reachable through the Codex CLI, invoked directly via Bash (my `~/.codex/config.toml` defaults to gpt-5.5). `codex exec "<prompt>"` for implementation, `codex exec -s read-only "<prompt>"` for investigation/analysis that must not touch the tree, `codex review` for reviews. Prompts must be fully self-contained: repo path, relevant AGENTS.md rules, exact files, and verification commands — Codex shares no context with your session. Iterate on a previous run with `codex resume <session-id>`. For long tasks, run via Bash with `run_in_background` instead of blocking. Do not use the codex plugin commands, skills, or agents.
- Claude models (sonnet-5, opus-4.8, fable-5) run via the Agent/Workflow model parameter.

Using gpt-5.5 inside workflows and subagents (the model parameter only takes Claude models, so use a wrapper):

- Spawn a thin Claude wrapper agent with `model: 'sonnet', effort: 'low'` whose prompt instructs it to write a self-contained codex prompt, run `codex exec` via Bash, and return Codex's final message verbatim.
