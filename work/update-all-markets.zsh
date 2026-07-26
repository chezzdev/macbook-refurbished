#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
workspace_dir="${script_dir:h}"
publication_lock_dir="${script_dir}/.publication-update.lock"
publication_lock_owner="all-markets-$$"
publication_lock_owner_file="${publication_lock_dir}/owner"

if ! mkdir "$publication_lock_dir" 2>/dev/null; then
  print -u2 "Another publication update is already running: $publication_lock_dir"
  exit 1
fi
print -r -- "$publication_lock_owner" > "$publication_lock_owner_file"

cleanup_publication_lock() {
  current_lock_owner=""
  if [[ -f "$publication_lock_owner_file" ]]; then
    current_lock_owner="$(<"$publication_lock_owner_file")"
  fi
  if [[ "$current_lock_owner" == "$publication_lock_owner" ]]; then
    rm -f -- "$publication_lock_owner_file"
    rmdir "$publication_lock_dir" 2>/dev/null || true
  fi
}
trap cleanup_publication_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export MACBOOK_PUBLICATION_LOCK_OWNER="$publication_lock_owner"

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
