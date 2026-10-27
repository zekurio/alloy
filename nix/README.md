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
  desktop recorder loads through `ALLOY_OBS_RUNTIME_DIR`: libobs with the
  modules the recorder opens, obs-vkcapture, obs-pipewire-audio-capture, and
  libpipewire. It copies them out of nixpkgs' OBS, so they come from the
  binary cache without OBS's UI, browser source, scripting, and VLC source.
  When the recorder opens another module, add it to the runtime's list. Build
  it from the same nixpkgs as the system, since libobs loads the system's
  graphics drivers.
- `desktop.nix` builds `.#alloy-desktop`, an Electron app: the recorder and
  the Node-API addon from one Cargo build (`alloy-desktop-rust`), the Electron
  bundles from the server package's pnpm dependencies (`alloy-desktop-shell`),
  the OBS runtime, FFmpeg, and the `dev.zekurio.alloy` desktop entry. It ships
  no graphics drivers; those come from the system. `nix flake check` doesn't
  build it; the `nix desktop` workflow does when its inputs change.
- `electron.nix` fetches the Electron release `packages/desktop/package.json`
  pins, for the desktop package and the devenv shell.
- `pipewire-client.nix` copies the PipeWire client that OBS and Electron load
  out of nixpkgs' PipeWire, without the daemon's plugins and the GStreamer,
  Bluetooth, and Python they bring in. A client logs the modules and SPA
  plugins it can't load; add any it needs to the lists there.
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

Building it needs a nixpkgs from 26.05 on, which has `pnpm_11`. On older
channels, use the flake's own build:

```nix
programs.alloy-desktop.package = inputs.alloy.packages.x86_64-linux.alloy-desktop;
```

Without the module, install the package. Built from the system's nixpkgs, it
builds locally:

```sh
nix profile add github:zekurio/alloy#alloy-desktop --override-input nixpkgs nixpkgs
# or from the flake's pinned nixpkgs, which Cachix has built, when it is at
# least as new as the system's:
nix profile add github:zekurio/alloy#alloy-desktop
```

What the package can't do on its own:

- **Provide graphics drivers.** Electron and libobs load the system's, from
  `/run/opengl-driver`, which NixOS sets up with `hardware.graphics`. The
  drivers need a glibc at least as new as the one they were built with, so a
  build from a nixpkgs older than the system's can't load them: Electron
  renders in software and OBS can't open an EGL display. Build from the
  system's nixpkgs, with the module or `--override-input nixpkgs nixpkgs`. On
  other distributions, point the app at drivers from the same nixpkgs, for
  example through nixGL or a `/run/opengl-driver` you set up.
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

When the Electron pin in `packages/desktop/package.json` changes,
`nix build .#alloy-desktop` fails with the new release's hash; copy its
`got: sha256-...` into `electron.nix`.

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
devenv test
```

After changing the desktop app, its Cargo workspace, or the Nix files and
nixpkgs pin it builds from, also run `nix build .#alloy-desktop`.

`devenv test` builds the shell, runs the entry hook and checks that it produced
`.env` and a reachable Postgres. CI runs it when the devenv files change.

On a non-Linux host, `nix flake check` skips the Linux checks. Use
`nix flake check --all-systems --no-build` to evaluate them, and a Linux
builder for the full check and package build. Evaluation alone does not
validate the dependency hash or offline install.
