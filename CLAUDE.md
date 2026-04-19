# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Onboarding
  
You can figure out most things yourself. This a turbo monorepo, so be aware of were your CWD currently is.

## VCS

This repo uses jj, so stick to it. If the number of changes grows to big, you can create bookmarks with fitting descriptions, to allow for easier rollbacks.

## Nix

With `flake.nix` present, assume you are running on a NixOS system, or a system using the nix package manager. Arbitrary binaries can be execute simply from the nix repos.

## Workflow

Talk through details of implementations with the user. Don't make too many assumptions as you are more often than not wrong. After each code pass, run a lint and typecheck command to check for code quality. Do not ask the user if you should fix issues.
