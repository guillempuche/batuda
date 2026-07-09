{
  description = "Forja — B2B prospecting platform";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # The new Unikraft Cloud CLI (`unikraft`), used to build and deploy
        # apps/server + apps/mail-worker to Unikraft Cloud. It replaces the old
        # `kraft` (kraftkit) CLI. nixpkgs only ships the old `kraft` (0.12.5),
        # not this new binary, so it's pulled straight from the upstream release
        # tarball at unikraft-cloud/cli and pinned per platform. CI installs the
        # same CLI via unikraft/setup-action; this keeps `unikraft build`,
        # `unikraft login`, and `unikraft run` available in the dev shell for
        # local spikes and manual deploys. Bump `unikraftCliVersion` + all four
        # hashes together from a new release (see cli_<version>_checksums.txt).
        unikraftCliVersion = "0.4.1";
        unikraftCliPlatform = {
          "x86_64-linux" = { os = "linux"; arch = "amd64"; hash = "df819d8f1ad31c96999d3452ca8fa366d3296b78e189ba5b3a011af487457df3"; };
          "aarch64-linux" = { os = "linux"; arch = "arm64"; hash = "a4b753909d19d2f92913a45675f3455bb2f56f6a9f02a973d5f649e90015b64c"; };
          "x86_64-darwin" = { os = "darwin"; arch = "amd64"; hash = "b8b92139fc18cb4f6ee5d9e7226a4a8927c87a79f26025ce9756af983527d6b6"; };
          "aarch64-darwin" = { os = "darwin"; arch = "arm64"; hash = "373e0aee92733484b073e5da99129bfda7638555fe8cb7ffb30e85b5dd4c4f0c"; };
        }.${system};
        unikraft-cli = pkgs.stdenv.mkDerivation {
          pname = "unikraft-cli";
          version = unikraftCliVersion;
          src = pkgs.fetchurl {
            url = "https://github.com/unikraft-cloud/cli/releases/download/v${unikraftCliVersion}/unikraft-cli_${unikraftCliVersion}_${unikraftCliPlatform.os}_${unikraftCliPlatform.arch}.tar.gz";
            sha256 = unikraftCliPlatform.hash;
          };
          # The tarball holds the `unikraft` binary plus a docs/ tree at its
          # root with no single top-level folder, so unpack in place.
          sourceRoot = ".";
          # The Linux build is a dynamically linked Go binary; patch its
          # interpreter so it runs on NixOS. macOS needs no patching.
          nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.autoPatchelfHook ];
          buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.stdenv.cc.cc.lib ];
          installPhase = ''
            runHook preInstall
            install -Dm755 unikraft $out/bin/unikraft
            runHook postInstall
          '';
          # The binary is `unikraft`, not the package name `unikraft-cli`, so
          # name it for `nix run .#unikraft-cli`.
          meta.mainProgram = "unikraft";
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.dprint
            # New Unikraft Cloud CLI — see the unikraft-cli derivation above.
            unikraft-cli
            # Cloudflare Workers CLI. Used to deploy apps/internal (the
            # batuda-web TanStack Start app) to Workers. Installed via nix
            # so `wrangler login`, `wrangler deploy`, `wrangler dev` work
            # without each contributor having to `pnpm exec wrangler …`.
            pkgs.wrangler
            # AWS CLI (v2). Used by scripts/gh-pr-media.sh to upload PR
            # screenshots/recordings to the shared media bucket over S3
            # (provider-agnostic — the bucket happens to live on R2). Installed
            # via nix so `/pr` media upload works on every contributor's laptop
            # with no manual install.
            pkgs.awscli2
            # ffmpeg — compresses /pr screen recordings before upload.
            # agent-browser records full-resolution WebM with no quality knob,
            # so a few desktop seconds is several MB; ffmpeg downscales, drops
            # the frame rate, and transcodes to a compact MP4. Installed via nix
            # so the /pr media flow is identical on every contributor's laptop.
            pkgs.ffmpeg
            # libwebp — provides `cwebp`, which the /pr uploader uses to convert
            # PNG/JPEG screenshots to WebP (crisp UI text, ~8x smaller). Paired
            # with ffmpeg so scripts/gh-pr-media.sh can compact every capture.
            pkgs.libwebp
            # Local OpenTelemetry receiver + TUI viewer.
            # Listens on :4317 (gRPC) and :4318 (OTLP/HTTP JSON).
            # Point OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
            # at it to inspect traces, logs, and metrics while developing.
            # Upstream: https://github.com/ymtdzzz/otel-tui
            pkgs.otel-tui
            # Infisical CLI — prod secrets for cloud CLI ops (`--env cloud`) and
            # the Infisical→GitHub secret sync. Pinned here so the core team has
            # it without a manual install; local dev runs on `pnpm cli setup`
            # defaults and never needs it.
            pkgs.infisical
          ];

          shellHook = ''
            echo "Forja dev environment"
            echo "Node:     $(node --version)"
            echo "unikraft: $(unikraft version 2>/dev/null | awk '/version:/{print $2; exit}' || echo 'available')"
            echo "pnpm:     $(pnpm --version)"
            echo "infisical:$(infisical --version 2>/dev/null || echo ' available')"
            echo "wrangler: $(wrangler --version 2>/dev/null || echo 'available')"
            echo "aws:      $(aws --version 2>/dev/null || echo 'available')"
            echo "ffmpeg:   $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"
            echo "cwebp:    $(cwebp -version 2>/dev/null | head -1)"
            echo "otel-tui: $(otel-tui --version 2>/dev/null || echo 'available')"
          '';
        };

        # Also exposed as a package so `nix build .#unikraft-cli` /
        # `nix run .#unikraft-cli` work without entering the dev shell.
        packages.unikraft-cli = unikraft-cli;
      }
    );
}
