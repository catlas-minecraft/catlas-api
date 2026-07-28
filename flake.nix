{
  description = "Node.js development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    vp-nix.url = "github:naitokosuke/vp-nix";
  };

  outputs =
    {
      self,
      nixpkgs,
      rust-overlay,
      vp-nix,
    }:
    let
      system = "aarch64-darwin"; # Apple Silicon Mac
      pkgs = import nixpkgs {
        inherit system;
        overlays = [ rust-overlay.overlays.default ];
      };

      nodejs = pkgs.nodejs_24;
      rustToolchain = pkgs.rust-bin.stable.latest.default.override {
        extensions = [
          "rust-analyzer"
          "rust-src"
        ];
      };
      dieselCli = pkgs.diesel-cli.override {
        postgresqlSupport = true;
        sqliteSupport = false;
        mysqlSupport = false;
      };
      vp = vp-nix.packages.${system}.default;
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs
          rustToolchain
          dieselCli
          vp
          pnpm_10

          git
          jq
          libpq
          pkg-config
        ];

        shellHook = ''
          export PATH="$PWD/node_modules/.bin:$PATH"

          if [[ -t 1 ]]; then
            echo "Node: $(node -v)"
            echo "pnpm:  $(pnpm -v)"
            echo "Rust: $(rustc --version)"
          fi
        '';
      };
    };
}
