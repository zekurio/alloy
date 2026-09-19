# Nix packaging

`flake.nix` exposes the Linux server package, container image, and NixOS
module. The development shell lives separately in `devenv.nix`.

## Files

- `package.nix` fetches the workspace dependencies, builds the server and web
  app, and packages the server's runtime dependency closure. It uses Node 24
  for builds and the slim Node 24 package at runtime.
- `pnpm.nix` reads the exact pnpm version from `package.json` and overrides
  the explicit `pnpm_11` builder. Both packaging and the development shell
  import it. Do not replace this builder with the moving `pkgs.pnpm` alias.
- `source.nix` excludes local state and generated artifacts from the build
  source, including nested workspace outputs.
- `module.nix` defines `services.alloy-server`, including PostgreSQL,
  storage, credentials, and systemd hardening.
- `module-security-test.nix` checks production-mode and HTTPS enforcement,
  including environment overrides.

The top-level `pnpmConfigHook` uses the pnpm executable in `nativeBuildInputs`.
`fetchPnpmDeps` receives that same pinned package explicitly. Neither should
select nixpkgs' default pnpm independently.

## Updating pnpm or dependencies

Keep the exact pnpm version in `package.json`. When changing it, update the
tarball hash in `pnpm.nix` too. A major-version change also requires reviewing
the Nix builder interface and validating the Windows desktop workflows.

Install with the pinned pnpm and commit any intended lockfile changes. If the
dependency store changes, regenerate `pnpmDepsHash` in `package.nix`:

1. Temporarily set `pnpmDepsHash` to `""`.
2. Run `nix build .#alloy --print-build-logs` on an x86_64-linux builder.
3. Copy the reported `got: sha256-...` hash into `pnpmDepsHash`.
4. Rebuild with the real hash and run `nix flake check`.

Keep the nixpkgs inputs in `flake.lock` and `devenv.lock` aligned when updating
them. Pinning pnpm does not pin nixpkgs' fetcher implementation, so a nixpkgs
update still needs a package build.

## Validation

```sh
pnpm verify
nix flake check
nix build .#alloy
```

On a non-Linux host, `nix flake check` skips the Linux checks. Use
`nix flake check --all-systems --no-build` to evaluate them, and a Linux
builder for the full check and package build. Evaluation alone does not
validate the dependency hash or offline install.
