#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
workspace_dir="${script_dir:h}"
all_markets_lock="${script_dir}/.all-markets-update.lock"

if ! mkdir "$all_markets_lock" 2>/dev/null; then
  print -u2 "Another all-market update is already running: $all_markets_lock"
  exit 1
fi
trap 'rmdir "$all_markets_lock" 2>/dev/null || true' EXIT INT TERM

market_ids=("${(@f)$(node "${workspace_dir}/scripts/publication-manifest.mjs" --market-ids)}")
if (( ${#market_ids[@]} == 0 )); then
  print -u2 "No enabled markets were found."
  exit 1
fi

for market_id in "${market_ids[@]}"; do
  print "Updating enabled market: ${market_id}"
  "${script_dir}/update-market-site.zsh" --market "$market_id"
done

print "All enabled markets updated successfully: ${market_ids[*]}"
