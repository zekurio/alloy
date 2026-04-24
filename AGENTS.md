# AGENTS.md

This file provides guidance to AI agents running in this repo.

## Onboarding
  
You can figure out most things yourself. This is a turbo monorepo, so be aware of where your CWD currently is.

## VCS

This repository uses Jujutsu (`jj`). Do not use Git commands.

Agents operate within a **shared working copy**. Do not create separate working copies per agent.

### Change management

- Do not automatically finalize changes after every prompt.
- Group edits into **one logical change**.
- When a logical unit of work is complete, ask the user whether to finalize it.

If approved, run:

```bash
jj describe -m "<type>: <what changed>"
jj new
```

### Creating new changes

Create a new change when:
- starting a **distinct task or concern**
- work diverges significantly from the current change
- changes would otherwise become mixed or hard to review

```bash
jj new
```

### Keeping changes clean

- Each change must represent a **single logical step**
- Do not mix unrelated edits in one change
- If a change becomes too large or mixed, split it:

```bash
jj split
```

### Multi-agent coordination

- All agents share the same workspace and repository state
- Do not perform conflicting edits in parallel
- Prefer assigning agents **separate concerns**, not separate files arbitrarily
- If multiple agents contribute:
  - keep their work in **separate changes**, not separate working copies
  - ensure changes remain independently understandable and reviewable

### Commit messages

- Follow conventional commits (`feat:`, `fix:`, `refactor:`, etc.)
- Messages should describe **what changed**, not just intent

### Safety

- Avoid destructive operations unless explicitly requested
- If unsure whether to amend, split, or create a new change, ask the user first

## Nix

With `flake.nix` present, assume you are running on a NixOS system or a system using the Nix package manager. Arbitrary binaries can be executed from the Nix repositories.

## Workflow

Talk through details of implementations with the user. Do not make assumptions.

After each code pass:
1. Run lint and typecheck.
2. Fix all issues without asking.

## Code Quality

Follow best practices. Keep the app fast and responsive.

- Prefer composition over duplication. If similar components are repeated, extract a shared primitive.
- Use existing UI primitives whenever possible instead of reimplementing patterns.
- Keep components small, focused, and reusable.
- Avoid unnecessary re-renders and expensive computations.
- Co-locate logic where it is used, but extract when reuse becomes clear.
