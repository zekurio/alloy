# Nix packaging

`flake.nix` exposes the Linux server package, container image, and NixOS
module, and the Linux desktop app with its own module. The development shell
lives separately in `devenv.nix`.

## Files

- `package.nix` fetches the workspace dependencies, builds the server and web
  app, and packages the server's runtime dependency closure. It uses Node 24
  for builds and the slim Node 24 package at runtime.
- `pnpm.nix` reads the exact pnpm version from `package.json` and overrides
  the explicit `pnpm_11` builder. Both packaging and the development shell
  import it. Do not replace this builder with the moving `pkgs.pnpm` alias.
- `source.nix` excludes local state and generated artifacts from the build
  source, including nested workspace outputs.
- `obs-runtime.nix` builds `.#alloy-obs-runtime`, the OBS prefix the Linux
  desktop recorder loads through `ALLOY_OBS_RUNTIME_DIR`: OBS with
  obs-vkcapture, obs-pipewire-audio-capture, and libpipewire. Build it from the
  same nixpkgs as the system, since libobs loads the system's graphics
  drivers.
- `desktop.nix` builds `.#alloy-desktop`: the recorder and the native addon
  from one Cargo build, the Electron bundles from the server package's pnpm
  dependencies, nixpkgs' Electron, the OBS runtime, FFmpeg, and the
  `dev.zekurio.alloy` desktop entry, with Mesa and Intel's VA-API driver for
  when the system's graphics drivers don't load.
- `desktop-module.nix` (`nixosModules.desktop`) defines
  `programs.alloy-desktop`, which builds the app from the system's nixpkgs
  and sets up game capture.
- `module.nix` defines `services.alloy-server`, including PostgreSQL,
  storage, credentials, and systemd hardening.
- `module-security-test.nix` checks production-mode and HTTPS enforcement,
  including environment overrides.
- `dev-dotenv.sh` and `dev-postgres.sh` back the devenv shell hook. The first
  creates `.env` from `.env.example` with generated local secrets. The second
  runs the repo-local Postgres on a Unix socket under devenv's runtime
  directory; `devenv.nix` exposes it as `alloy-postgres start|stop` and
  `alloy-postgres-stop`.

The top-level `pnpmConfigHook` uses the pnpm executable in `nativeBuildInputs`.
`fetchPnpmDeps` receives that same pinned package explicitly. Neither should
select nixpkgs' default pnpm independently.

## Alloy desktop

On NixOS, use the module. It builds the app from the system's nixpkgs and adds
obs-vkcapture's Vulkan layer and `OBS_VKCAPTURE=1` for games:

```nix
{
  inputs.alloy.url = "github:zekurio/alloy";

  # in the system's modules:
  imports = [ inputs.alloy.nixosModules.desktop ];
  programs.alloy-desktop.enable = true;
}
```

Without the module, install the package. Built from the system's nixpkgs, it
uses the system's graphics drivers as they are, but builds locally:

```sh
nix profile add github:zekurio/alloy#alloy-desktop --override-input nixpkgs nixpkgs
# or from the flake's pinned nixpkgs, which Cachix has built:
nix profile add github:zekurio/alloy#alloy-desktop
```

What the package can't do on its own:

- **Always use the system's graphics drivers.** Electron and libobs load the
  drivers in `/run/opengl-driver`, which need a glibc at least as new as the
  one they were built with. When the flake's pinned nixpkgs is older than the
  system's, the app falls back to the Mesa and Intel VA-API driver it ships
  with. Those cover AMD and Intel GPUs, for rendering and encoding, but can
  trail the system's driver releases. NVIDIA's own EGL library still loads
  first, though that path is untested. Build from the system's nixpkgs, with
  the module or `--override-input nixpkgs nixpkgs`, to skip the fallback.
- **Capture games.** obs-vkcapture's layer has to load in the game, through
  `hardware.graphics.extraPackages` and `OBS_VKCAPTURE=1` in the game's
  environment, which a package can't change. The module sets both; otherwise,
  add them yourself or start games with `OBS_VKCAPTURE=1 %command%` in Steam.
  Without the layer, game sessions fall back to display capture. OpenGL games
  also need obs-vkcapture's `obs-gamecapture` wrapper. Whether Steam's
  Proton container sees the layer on NixOS is not yet tested.
- **Bind global shortcuts under `nix run`.** The shortcuts portal only
  accepts an app whose desktop entry is installed, which `nix run` doesn't
  do. Install the package or use the module. On desktops without the
  portal, bind the entry's _Save a clip_ and _Take a screenshot_ actions, or
  `alloy-desktop --action clip`, to keys.
- **Provide the session's services.** PipeWire with WirePlumber, and
  xdg-desktop-portal with a ScreenCast and a GlobalShortcuts backend (KDE,
  GNOME 48 or later, Hyprland), come with the desktop.
- **Start at login or update itself.** Linux has no autostart setting yet,
  and updates come through Nix.

The app runs on nixpkgs' Electron, which can trail the version
`packages/desktop/package.json` pins by a few releases.

## Updating pnpm or dependencies

Keep the exact pnpm version in `package.json`; `pnpm/action-setup` in the
workflows reads it from there. When changing it, update the
tarball hash in `pnpm.nix` too. A major-version change also requires reviewing
the Nix builder interface and validating the Windows desktop workflows.

Install with the pinned pnpm and commit any intended lockfile changes. If the
dependency store changes, regenerate `pnpmDepsHash` in `package.nix`:

1. Temporarily set `pnpmDepsHash` to `""`.
2. Run `nix build .#alloy --print-build-logs` on an x86_64-linux builder.
3. Copy the reported `got: sha256-...` hash into `pnpmDepsHash`.
4. Rebuild with the real hash and run `nix flake check`.

Keep the nixpkgs inputs in `flake.lock` and `devenv.lock` aligned: run
`nix flake update nixpkgs` and `devenv update nixpkgs` together. The `devenv`
workflow fails when the two revisions differ. Pinning pnpm does not pin
nixpkgs' fetcher implementation, so a nixpkgs update still needs a package
build.

## Validation

```sh
pnpm verify
nix flake check
nix build .#alloy
nix build .#alloy-desktop
devenv test
```

`devenv test` builds the shell, runs the entry hook and checks that it produced
`.env` and a reachable Postgres. CI runs it when the devenv files change.

On a non-Linux host, `nix flake check` skips the Linux checks. Use
`nix flake check --all-systems --no-build` to evaluate them, and a Linux
builder for the full check and package build. Evaluation alone does not
validate the dependency hash or offline install.
