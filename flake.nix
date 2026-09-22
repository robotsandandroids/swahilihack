{
  description = "SemaAI - practice spoken Swahili with an in-character AI (FastAPI + Next.js)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        python = pkgs.python313;

        # Self-contained Python env built entirely from nixpkgs. Every runtime
        # and dev dependency the backend needs is available without touching
        # PyPI. NOTE: nixpkgs ships openai 2.x while pyproject.toml wants the
        # v3 SDK; for lockfile-exact versions run `uv sync` / `uv run` instead
        # (the `uv` binary is also in the shell).
        backendEnv = python.withPackages (ps: [
          ps.fastapi
          ps.httpx
          ps.openai
          ps.pydantic-settings
          ps.python-dotenv
          ps.python-multipart
          ps.snowballstemmer
          ps.uvicorn
          ps.faster-whisper
          # dev
          ps.pytest
          ps.mypy
          ps.ruff
        ]);

        # Node toolchain for the frontend. Dependency versions stay pinned by
        # pnpm-lock.yaml; `pnpm install` after entering the shell.
        frontendPkgs = with pkgs; [ nodejs_24 pnpm ];

        backendShellHook = ''
          echo "SemaAI backend shell"
          echo "  uv run    -- lockfile-exact deps (recommended, matches uv.lock)"
          echo "  uvicorn   -- nixpkgs-built deps (openai 2.x)"
          echo "  pytest    -- run the test suite"
          echo "Start: uv sync && uv run uvicorn app.main:app --reload"
        '';
      in
      {
        devShells = {
          backend = pkgs.mkShell {
            packages = [ python pkgs.uv pkgs.ffmpeg backendEnv ];
            shellHook = backendShellHook;
          };

          frontend = pkgs.mkShell {
            packages = frontendPkgs;
            shellHook = ''
              echo "SemaAI frontend shell (node $(node --version), pnpm $(pnpm --version))"
              echo "Start: pnpm install && pnpm dev"
            '';
          };

          default = pkgs.mkShell {
            inputsFrom = [
              self.devShells.${system}.backend
              self.devShells.${system}.frontend
            ];
            packages = [ pkgs.git ];
            shellHook = ''
              echo "SemaAI monorepo shell"
              echo "  nix develop .#backend   -- FastAPI toolchain"
              echo "  nix develop .#frontend  -- Next.js toolchain"
            '';
          };
        };
      });
}