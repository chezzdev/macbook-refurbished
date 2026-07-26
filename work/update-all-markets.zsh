#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
workspace_dir="${script_dir:h}"
publication_lock_dir="${script_dir}/.publication-update.lock"
publication_lock_owner="all-markets-$$"
publication_lock_owner_file="${publication_lock_dir}/owner"
temporary_root="${TMPDIR:-/tmp}"
temporary_root="${temporary_root:A}"
batch_snapshot_dir=""

if ! mkdir "$publication_lock_dir" 2>/dev/null; then
  print -u2 "Another publication update is already running: $publication_lock_dir"
  exit 1
fi
print -r -- "$publication_lock_owner" > "$publication_lock_owner_file"

cleanup_publication_lock() {
  if [[ -n "$batch_snapshot_dir" && -d "$batch_snapshot_dir" && \
        "$batch_snapshot_dir" == "${temporary_root%/}/macbook-batch-snapshot."* ]]; then
    rm -rf -- "$batch_snapshot_dir"
  fi
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

if ! git -C "$workspace_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  print -u2 "All-market publication requires a reviewed outer Git worktree."
  exit 1
fi
batch_source_head="$(git -C "$workspace_dir" rev-parse HEAD)"
batch_snapshot_dir="$(
  mktemp -d "${temporary_root%/}/macbook-batch-snapshot.XXXXXX"
)"
batch_snapshot_dir="${batch_snapshot_dir:A}"
git -C "$workspace_dir" archive "$batch_source_head" |
  tar -x -C "$batch_snapshot_dir"

immutable_source_paths=("${(@f)$(node "${batch_snapshot_dir}/scripts/publication-manifest.mjs" --immutable-source)}")
batch_source_changes="$(
  git -C "$workspace_dir" diff --name-status "$batch_source_head" -- \
    "${immutable_source_paths[@]}"
)"
if [[ -n "$batch_source_changes" ]]; then
  print -u2 "All-market publication refuses uncommitted source/config changes:"
  print -u2 "$batch_source_changes"
  exit 1
fi

market_ids=("${(@f)$(node "${batch_snapshot_dir}/scripts/publication-manifest.mjs" --market-ids)}")
if (( ${#market_ids[@]} == 0 )); then
  print -u2 "No enabled markets were found."
  exit 1
fi
export MACBOOK_SOURCE_HEAD="$batch_source_head"
export MACBOOK_BATCH_SOURCE_VERIFIED=true
export MACBOOK_WORKSPACE_DIR="$workspace_dir"

for market_id in "${market_ids[@]}"; do
  print "Updating enabled market: ${market_id}"
  "${batch_snapshot_dir}/work/update-market-site.zsh" --market "$market_id"
done

print "All enabled markets updated successfully: ${market_ids[*]}"
