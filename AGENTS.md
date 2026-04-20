# AGENTS.md

This file provides guidance to AI agents running in this repo.

## Onboarding
  
You can figure out most things yourself. This a turbo monorepo, so be aware of were your CWD currently is.

## VCS

This repo uses jj, so stick to it. If the number of changes grows to big, you can create bookmarks with fitting descriptions, to allow for easier rollbacks.

## Nix

With `flake.nix` present, assume you are running on a NixOS system, or a system using the nix package manager. Arbitrary binaries can be execute simply from the nix repos.

## Workflow

Talk through details of implementations with the user. Don't make too many assumptions as you are more often than not wrong. After each code pass, run a lint and typecheck command to check for code quality. Do not ask the user if you should fix issues. If both pass, follow these up with a `pnpm dlx aislop scan --json`, if issues can be auto-fixed, run `pnpm dlx aislop fix`. Fix the rest of the remaining issues.

## Code Quality

You should try to stick to best practices,
