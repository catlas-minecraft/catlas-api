#!/usr/bin/env bash

set -euo pipefail

root="$(git rev-parse --show-toplevel)"
target="$root/packages/api_rs/src/schema.rs"
config="$root/packages/api_rs/diesel.toml"
temporary="$(mktemp "$target.tmp.XXXXXX")"
generated_header="// @generated automatically by Diesel CLI."
schemas=(core draft derived history)

trap 'rm -f "$temporary"' EXIT

if [[ "${1:-}" == "--direct" ]]; then
  diesel=(diesel)
else
  diesel=(nix develop --command diesel)
fi

generated="$generated_header"

for schema in "${schemas[@]}"; do
  output="$("${diesel[@]}" print-schema --config-file "$config" --schema "$schema")"
  output="${output#"$generated_header"$'\n\n'}"
  generated+=$'\n\n'
  generated+="$output"
done

printf '%s\n' "$generated" > "$temporary"
chmod 0644 "$temporary"
mv "$temporary" "$target"
