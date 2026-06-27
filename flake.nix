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
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.dprint
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
            echo "pnpm:     $(pnpm --version)"
            echo "infisical:$(infisical --version 2>/dev/null || echo ' available')"
            echo "wrangler: $(wrangler --version 2>/dev/null || echo 'available')"
            echo "aws:      $(aws --version 2>/dev/null || echo 'available')"
            echo "ffmpeg:   $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"
            echo "cwebp:    $(cwebp -version 2>/dev/null | head -1)"
            echo "otel-tui: $(otel-tui --version 2>/dev/null || echo 'available')"
          '';
        };
      }
    );
}
