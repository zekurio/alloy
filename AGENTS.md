# AGENTS.md

This file provides guidance to AI agents running in this repo.

## Onboarding
  
You can figure out most things yourself. This is a turbo monorepo, so be aware of where your CWD currently is.

## VCS

This repository uses Jujutsu (jj). Do not use Git commands directly.

Do not automatically finalize changes after every prompt.

When a logical unit of work appears complete, briefly ask the user whether the current change should be finalized. If the user agrees, run:

```bash
jj describe -m "<type>: <what changed>"
jj new
```

Rules:
- Each change should represent one logical step.
- Do not accumulate unrelated changes in a single change unless explicitly requested.
- Messages must follow conventional commits (e.g. `feat:`, `fix:`, `refactor:`) and describe what changed.
- If work diverges significantly, suggest starting a new change (`jj new`).
- If a change becomes mixed or too large, suggest:
  ```bash
  jj split
  ```

## Nix

With `flake.nix` present, assume you are running on a NixOS system or a system using the Nix package manager. Arbitrary binaries can be executed from the Nix repositories.

## Workflow

Talk through details of implementations with the user. Do not make assumptions.

After each code pass:
1. Run lint and typecheck.
2. Fix all issues without asking.
3. If both pass, run:
   ```bash
   pnpm dlx aislop scan --json
   ```
4. If issues can be auto-fixed, run:
   ```bash
   pnpm dlx aislop fix
   ```
5. Fix any remaining issues.

## Code Quality

Follow best practices. Keep the app fast and responsive.

- Prefer composition over duplication. If similar components are repeated, extract a shared primitive.
- Use existing UI primitives whenever possible instead of reimplementing patterns.
- Keep components small, focused, and reusable.
- Avoid unnecessary re-renders and expensive computations.
- Co-locate logic where it is used, but extract when reuse becomes clear.
