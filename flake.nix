{
  description = "Forja — B2B prospecting platform";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # The official Unikraft CLI, packaged by the Unikraft team in their NUR
    # (GoReleaser-generated, auto-updated per release). Follows our nixpkgs so
    # there's a single package set.
    unikraft-nur = {
      url = "github:unikraft/nur";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, unikraft-nur }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # The official Unikraft Cloud CLI (`unikraft`), used to build and deploy
        # apps/server + apps/mail-worker. It replaces the old `kraft` (kraftkit)
        # CLI, which is all nixpkgs ships. Taken from the Unikraft team's NUR —
        # the `unikraft-cli-staging` attr, since the NUR's stable `unikraft-cli`
        # attr is being fixed upstream. This keeps `unikraft build`/`login`/`run`
        # in the dev shell for local spikes and manual deploys; bump it with
        # `nix flake update unikraft-nur`. (CI installs its own copy via
        # unikraft/setup-action.)
        unikraft-cli = unikraft-nur.packages.${system}.unikraft-cli-staging;
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
