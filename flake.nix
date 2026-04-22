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
            # Local OpenTelemetry receiver + TUI viewer.
            # Listens on :4317 (gRPC) and :4318 (OTLP/HTTP JSON).
            # Point OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
            # at it to inspect traces, logs, and metrics while developing.
            # Upstream: https://github.com/ymtdzzz/otel-tui
            pkgs.otel-tui
          ];

          shellHook = ''
            echo "Forja dev environment"
            echo "Node:     $(node --version)"
            echo "pnpm:     $(pnpm --version)"
            echo "otel-tui: $(otel-tui --version 2>/dev/null || echo 'available')"
          '';
        };
      }
    );
}
