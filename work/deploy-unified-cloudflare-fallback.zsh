#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
workspace_dir="${MACBOOK_WORKSPACE_DIR:-${script_dir:h}}"
workspace_dir="${workspace_dir:A}"
publish_dir="${MACBOOK_PUBLISH_DIR:-${workspace_dir}/work/gh-pages-site}"
publish_dir="${publish_dir:A}"
temporary_root="${TMPDIR:-/tmp}"
temporary_root="${temporary_root:A}"
publication_lock_dir="${workspace_dir}/work/.publication-update.lock"
publication_lock_owner_file="${publication_lock_dir}/owner"
publication_lock_owner="cloudflare-fallback-$$"
publication_lock_owned=false
deployment_dir=""
runtime_dir=""
expected_remote="git@github.com:chezzdev/macbook-refurbished.git"
expected_branch="main"

source "${script_dir}/publication-guards.zsh"

cleanup() {
  exit_code=$?
  set +e
  if [[ -n "$deployment_dir" && -d "$deployment_dir" && \
        "$deployment_dir" == "${temporary_root%/}/macbook-unified-fallback."* ]]; then
    rm -rf -- "$deployment_dir"
  fi
  if [[ -n "$runtime_dir" && -d "$runtime_dir" && \
        "$runtime_dir" == "${temporary_root%/}/macbook-fallback-runtime."* ]]; then
    rm -rf -- "$runtime_dir"
  fi
  if [[ "$publication_lock_owned" == "true" ]]; then
    current_lock_owner=""
    if [[ -f "$publication_lock_owner_file" ]]; then
      current_lock_owner="$(<"$publication_lock_owner_file")"
    fi
    if [[ "$current_lock_owner" == "$publication_lock_owner" ]]; then
      rm -f -- "$publication_lock_owner_file"
      rmdir "$publication_lock_dir" 2>/dev/null || true
    fi
  fi
  return "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! git -C "$publish_dir" rev-parse \
    --is-inside-work-tree >/dev/null 2>&1; then
  print -u2 "Unified publication checkout is missing: ${publish_dir}"
  exit 1
fi
if ! mkdir "$publication_lock_dir" 2>/dev/null; then
  print -u2 \
    "Another publication update is already running: $publication_lock_dir"
  exit 1
fi
print -r -- "$publication_lock_owner" > "$publication_lock_owner_file"
publication_lock_owned=true

publication_require_clean_synced_checkout \
  "$publish_dir" "$expected_remote" "$expected_branch" || exit 1
if [[ ! -x "${workspace_dir}/node_modules/.bin/wrangler" ]]; then
  print -u2 "Pinned Wrangler is missing; run npm ci in ${workspace_dir}"
  exit 1
fi
publish_commit="$(git -C "$publish_dir" rev-parse HEAD)"

deployment_dir="$(
  mktemp -d "${temporary_root%/}/macbook-unified-fallback.XXXXXX"
)"
deployment_dir="${deployment_dir:A}"
runtime_dir="$(
  mktemp -d "${temporary_root%/}/macbook-fallback-runtime.XXXXXX"
)"
runtime_dir="${runtime_dir:A}"
git -C "$publish_dir" archive "$publish_commit" |
  tar -x -C "$deployment_dir"

manifest_script="${deployment_dir}/scripts/publication-manifest.mjs"
if [[ ! -f "$manifest_script" ]]; then
  print -u2 "Pinned publication manifest is missing."
  exit 1
fi
pinned_remote="$(node "$manifest_script" --repository)"
pinned_branch="$(node "$manifest_script" --branch)"
if [[ "$pinned_remote" != "$expected_remote" || \
      "$pinned_branch" != "$expected_branch" ]]; then
  print -u2 "Pinned publication manifest violates the repository contract."
  exit 1
fi
publication_require_clean_synced_checkout \
  "$publish_dir" "$expected_remote" "$expected_branch" || exit 1
if [[ "$(git -C "$publish_dir" rev-parse HEAD)" != "$publish_commit" ]]; then
  print -u2 "Publication HEAD changed after the fallback snapshot was pinned."
  exit 1
fi

for relative_file in ".nojekyll" "index.html"; do
  if [[ ! -f "${deployment_dir}/${relative_file}" ]]; then
    print -u2 "Unified publication file is missing: ${relative_file}"
    exit 1
  fi
done

market_artifacts=(
  "${(@f)$(node "$manifest_script" --market-artifacts)}"
)
if (( ${#market_artifacts[@]} == 0 )); then
  print -u2 "Pinned publication manifest contains no enabled markets."
  exit 1
fi
market_ids=()
typeset -A expected_hash_by_market
typeset -A route_by_market
for market_artifact in "${market_artifacts[@]}"; do
  IFS=$'\x1f' read -r market_id relative_file <<< "$market_artifact"
  if [[ -z "$market_id" || -z "$relative_file" ]]; then
    print -u2 "Pinned publication manifest contains an invalid market artifact."
    exit 1
  fi
  artifact_file="${deployment_dir}/${relative_file}"
  case "${artifact_file:A}" in
    "${deployment_dir}/"*) ;;
    *)
      print -u2 "Market artifact escaped the pinned archive: $relative_file"
      exit 1
      ;;
  esac
  if [[ ! -f "$artifact_file" ]]; then
    print -u2 "Unified publication file is missing: ${relative_file}"
    exit 1
  fi
  market_ids+=("$market_id")
  expected_hash_by_market[$market_id]="$(
    shasum -a 256 "$artifact_file" | awk '{print $1}'
  )"
  route_by_market[$market_id]="${relative_file:h}/"
done

fallback_projects=(
  "macbook-sg-refurbished|https://macbook-sg-refurbished.pages.dev"
  "macbook-us-refurbished|https://macbook-us-refurbished.pages.dev"
)

for fallback_target in "${fallback_projects[@]}"; do
  IFS="|" read -r cloudflare_project production_url <<< "$fallback_target"
  print "Deploying pinned unified fallback to ${cloudflare_project}"
  (
    cd "$runtime_dir"
    "${workspace_dir}/node_modules/.bin/wrangler" pages deploy "$deployment_dir" \
      --project-name "$cloudflare_project" \
      --branch "$expected_branch" \
      --commit-hash "$publish_commit"
  )

  for market_id in "${market_ids[@]}"; do
    expected_hash="${expected_hash_by_market[$market_id]}"
    market_route="${route_by_market[$market_id]}"
    live_file="${runtime_dir}/live-${cloudflare_project}-${market_id}.html"
    live_matches=false
    attempt_number=1
    while (( attempt_number <= 12 )); do
      if curl -fsSL --max-time 15 \
        "${production_url%/}/${market_route}?catalog_hash=${expected_hash}" \
        -o "$live_file"; then
        live_hash="$(shasum -a 256 "$live_file" | awk '{print $1}')"
        if [[ "$live_hash" == "$expected_hash" ]]; then
          live_matches=true
          break
        fi
      fi
      if (( attempt_number < 12 )); then
        sleep 5
      fi
      attempt_number=$((attempt_number + 1))
    done
    if [[ "$live_matches" != "true" ]]; then
      print -u2 \
        "${production_url%/}/${market_route} did not serve the pinned artifact"
      exit 1
    fi
  done
done

print \
  "Unified Cloudflare fallback deployment and live verification succeeded for: ${market_ids[*]}"
