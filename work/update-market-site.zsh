#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
workspace_dir="${MACBOOK_WORKSPACE_DIR:-${script_dir:h}}"
market_id=""
prepare_only=false
while (( $# > 0 )); do
  case "$1" in
    --market)
      if [[ -z "${2:-}" ]]; then
        print -u2 "Usage: $0 --market <enabled-market> [--prepare-only]"
        exit 2
      fi
      market_id="$2"
      shift 2
      ;;
    --prepare-only)
      prepare_only=true
      shift
      ;;
    *)
      print -u2 "Usage: $0 --market <enabled-market> [--prepare-only]"
      exit 2
      ;;
  esac
done
if [[ -z "$market_id" ]]; then
  print -u2 "Usage: $0 --market <enabled-market> [--prepare-only]"
  exit 2
fi

temporary_root="${TMPDIR:-/tmp}"
temporary_root="${temporary_root:A}"
source_head=""
source_snapshot_dir=""
execution_root="$workspace_dir"
if [[ "$prepare_only" != "true" ]]; then
  if ! git -C "$workspace_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    print -u2 "Live publication requires a reviewed outer Git worktree."
    exit 1
  fi
  requested_source_head="${MACBOOK_SOURCE_HEAD:-HEAD}"
  source_head="$(
    git -C "$workspace_dir" rev-parse --verify \
      "${requested_source_head}^{commit}"
  )"
  source_snapshot_dir="$(
    mktemp -d "${temporary_root%/}/macbook-source-snapshot.XXXXXX"
  )"
  source_snapshot_dir="${source_snapshot_dir:A}"
  git -C "$workspace_dir" archive "$source_head" |
    tar -x -C "$source_snapshot_dir"
  execution_root="$source_snapshot_dir"

  cleanup_bootstrap_snapshot() {
    if [[ -n "$source_snapshot_dir" && -d "$source_snapshot_dir" && \
          "$source_snapshot_dir" == "${temporary_root%/}/macbook-source-snapshot."* ]]; then
      rm -rf -- "$source_snapshot_dir"
    fi
  }
  trap cleanup_bootstrap_snapshot EXIT
fi

workflow_config="$(
  node "${execution_root}/scripts/print-market-workflow-config.mjs" "$market_id"
)"
IFS=$'\x1f' read -r \
  market_id site_name profile_relative catalog_relative featured_relative site_relative \
  update_status_relative update_delta_relative changelog_relative \
  artifact_directory_relative policy_relative cloudflare_project publication_provider \
  production_url repository_url publish_checkout_relative publication_artifact_directory \
  publication_branch approval_required <<< "$workflow_config"

if [[ "$approval_required" == "true" && "$prepare_only" != "true" ]]; then
  print -u2 "${site_name} publication is approval-gated."
  print -u2 "Approve the hosting project and final URL in config/markets/${market_id}.json before a live refresh or deployment."
  exit 1
fi
if [[ "$prepare_only" != "true" && "$publication_provider" != "cloudflare-pages" ]]; then
  print -u2 "${site_name} uses ${publication_provider}; run this workflow with --prepare-only and publish the validated artifact through its hosting provider."
  exit 1
fi
if [[ "$prepare_only" != "true" && ( -z "$production_url" || -z "$repository_url" ) ]]; then
  print -u2 "${site_name} is missing an approved production URL or repository."
  exit 1
fi

default_publish_dir="${workspace_dir}/${publish_checkout_relative}"
publication_lock_dir="${workspace_dir}/work/.publication-update.lock"
publication_lock_owner_file="${publication_lock_dir}/owner"
publication_lock_owner="${MACBOOK_PUBLICATION_LOCK_OWNER:-market-${market_id}-$$}"
publication_lock_owned=false
deployment_dir=""
metadata_dir=""
snapshot_dir=""
staging_dir=""
canonical_promotion_started=false
workflow_succeeded=false
allowed_ssh_remote="$repository_url"
allowed_https_remote="${repository_url/git@github.com:/https://github.com/}"
allowed_https_remote_short="${allowed_https_remote%.git}"
allowed_ssh_url_remote="${repository_url/git@github.com:/ssh://git@github.com/}"

source_owned_paths=("${(@f)$(node "${execution_root}/scripts/publication-manifest.mjs" --source)}")
immutable_source_paths=("${(@f)$(node "${execution_root}/scripts/publication-manifest.mjs" --immutable-source)}")
publish_owned_paths=("${(@f)$(node "${execution_root}/scripts/publication-manifest.mjs" --publish)}")
retired_publication_paths=("${(@f)$(node "${execution_root}/scripts/publication-manifest.mjs" --retired)}")

if [[ -d "${workspace_dir}/.git" && \
      -f "${workspace_dir}/scripts/update-apple-catalog.mjs" && \
      ! -d "${default_publish_dir}/.git" ]]; then
  publish_dir="$workspace_dir"
else
  publish_dir="$default_publish_dir"
fi
canonical_output_relatives=(
  "$catalog_relative"
  "$featured_relative"
  "$site_relative"
  "$update_status_relative"
  "$update_delta_relative"
  "$changelog_relative"
  "${artifact_directory_relative}/index.html"
)
typeset -A staged_output_by_relative
typeset -A snapshot_by_relative
typeset -A immutable_source_set

cleanup() {
  exit_code=$?
  set +e
  if [[ "$canonical_promotion_started" == "true" && \
        "$workflow_succeeded" != "true" ]]; then
    for relative_file in "${canonical_output_relatives[@]}"; do
      target_file="${workspace_dir}/${relative_file}"
      snapshot_file="${snapshot_by_relative[$relative_file]:-}"
      if [[ "$snapshot_file" == "__MISSING__" ]]; then
        rm -f -- "$target_file"
      elif [[ -n "$snapshot_file" && -f "$snapshot_file" ]]; then
        mkdir -p "${target_file:h}"
        cp "$snapshot_file" "${target_file}.restore"
        mv "${target_file}.restore" "$target_file"
      fi
    done
  fi
  if [[ -n "$deployment_dir" && -d "$deployment_dir" && \
        "$deployment_dir" == "${temporary_root%/}/macbook-pages."* ]]; then
    rm -rf -- "$deployment_dir"
  fi
  if [[ -n "$metadata_dir" && -d "$metadata_dir" && \
        "$metadata_dir" == "${temporary_root%/}/macbook-deploy-git."* ]]; then
    rm -rf -- "$metadata_dir"
  fi
  if [[ -n "$snapshot_dir" && -d "$snapshot_dir" && \
        "$snapshot_dir" == "${temporary_root%/}/macbook-canonical-before."* ]]; then
    rm -rf -- "$snapshot_dir"
  fi
  if [[ -n "$staging_dir" && -d "$staging_dir" && \
        "$staging_dir" == "${temporary_root%/}/macbook-market-stage."* ]]; then
    rm -rf -- "$staging_dir"
  fi
  if [[ -n "$source_snapshot_dir" && -d "$source_snapshot_dir" && \
        "$source_snapshot_dir" == "${temporary_root%/}/macbook-source-snapshot."* ]]; then
    rm -rf -- "$source_snapshot_dir"
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

if [[ -n "${MACBOOK_PUBLICATION_LOCK_OWNER:-}" ]]; then
  inherited_lock_owner=""
  if [[ -f "$publication_lock_owner_file" ]]; then
    inherited_lock_owner="$(<"$publication_lock_owner_file")"
  fi
  if [[ "$inherited_lock_owner" != "$publication_lock_owner" ]]; then
    print -u2 "The inherited publication lock is not owned by this workflow."
    exit 1
  fi
else
  if ! mkdir "$publication_lock_dir" 2>/dev/null; then
    print -u2 "Another publication update is already running: $publication_lock_dir"
    exit 1
  fi
  print -r -- "$publication_lock_owner" > "$publication_lock_owner_file"
  publication_lock_owned=true
fi
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$prepare_only" != "true" && \
      "${MACBOOK_BATCH_SOURCE_VERIFIED:-false}" != "true" ]]; then
  outer_source_changes="$(
    git -C "$workspace_dir" diff --name-status "$source_head" -- \
      "${immutable_source_paths[@]}"
  )"
  if [[ -n "$outer_source_changes" ]]; then
    print -u2 "Live publication refuses uncommitted source/config changes:"
    print -u2 "$outer_source_changes"
    exit 1
  fi
fi
if [[ "$prepare_only" != "true" ]]; then
  for relative_file in "${immutable_source_paths[@]}"; do
    immutable_source_set[$relative_file]=true
  done
fi

if [[ "$prepare_only" != "true" ]]; then
  if [[ ! -d "${publish_dir}/.git" ]]; then
    print -u2 "Private GitHub checkout is missing: $publish_dir"
    exit 1
  fi
  preexisting_changes="$(
    git -C "$publish_dir" status --porcelain --untracked-files=all -- \
      "${publish_owned_paths[@]}"
  )"
  if [[ -n "$preexisting_changes" ]]; then
    print -u2 "The private checkout has pre-existing changes in pipeline-owned files:"
    print -u2 "$preexisting_changes"
    exit 1
  fi
fi

cd "$execution_root"
snapshot_dir="$(mktemp -d "${temporary_root%/}/macbook-canonical-before.XXXXXX")"
staging_dir="$(mktemp -d "${temporary_root%/}/macbook-market-stage.XXXXXX")"
snapshot_number=0
for relative_file in "${canonical_output_relatives[@]}"; do
  canonical_file="${workspace_dir}/${relative_file}"
  snapshot_number=$((snapshot_number + 1))
  snapshot_file="${snapshot_dir}/${snapshot_number}"
  if [[ -f "$canonical_file" ]]; then
    cp "$canonical_file" "$snapshot_file"
    snapshot_by_relative[$relative_file]="$snapshot_file"
  else
    snapshot_by_relative[$relative_file]="__MISSING__"
  fi
done

for relative_file in \
  "$catalog_relative" \
  "$featured_relative" \
  "$site_relative" \
  "$update_status_relative" \
  "$update_delta_relative" \
  "$changelog_relative"; do
  canonical_file="${workspace_dir}/${relative_file}"
  staged_file="${staging_dir}/${relative_file}"
  staged_output_by_relative[$relative_file]="$staged_file"
  mkdir -p "${staged_file:h}"
  if [[ -f "$canonical_file" ]]; then
    cp "$canonical_file" "$staged_file"
  fi
done
staged_output_by_relative[${artifact_directory_relative}/index.html]="${staging_dir}/${artifact_directory_relative}/index.html"

promote_staged_outputs() {
  for relative_file in "${canonical_output_relatives[@]}"; do
    staged_file="${staged_output_by_relative[$relative_file]:-}"
    if [[ -z "$staged_file" || ! -f "$staged_file" ]]; then
      print -u2 "Validated staged output is missing: $staged_file"
      return 1
    fi
  done
  canonical_promotion_started=true
  for relative_file in "${canonical_output_relatives[@]}"; do
    staged_file="${staged_output_by_relative[$relative_file]}"
    canonical_file="${workspace_dir}/${relative_file}"
    mkdir -p "${canonical_file:h}"
    cp "$staged_file" "${canonical_file}.promote"
    mv "${canonical_file}.promote" "$canonical_file"
  done
}

MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node scripts/initialize-market.mjs --market "$market_id"

print "1/8 Fetching ${site_name} prices and currency data"
MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node scripts/update-apple-catalog.mjs --market "$market_id"
MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node scripts/validate-apple-catalog.mjs --market "$market_id"
MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node scripts/update-exchange-rate.mjs --market "$market_id"

print "2/8 Applying deterministic ranking policy"
MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node scripts/rank-models.mjs --market "$market_id"
MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node scripts/rank-models.mjs --market "$market_id" --check
MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node scripts/update-changelog.mjs \
  --market "$market_id" \
  --previous-catalog "${workspace_dir}/${catalog_relative}" \
  --previous-featured "${workspace_dir}/${featured_relative}"

print "3/8 Running parser, currency, and ranking tests"
MACBOOK_STAGED_MARKET_ID="$market_id" \
MACBOOK_STAGED_NAMESPACE_ROOT="$staging_dir" \
node --test \
  scripts/apple-catalog-lib.test.mjs \
  tests/changelog.test.mjs \
  tests/exchange-rate.test.mjs \
  tests/html-escape.test.mjs \
  tests/market-engine.test.mjs \
  tests/rank-models.test.mjs

print "4/8 Building the standalone page twice"
MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node work/build-expanded-standalone.mjs --market "$market_id"
artifact_file="${staging_dir}/${artifact_directory_relative}/index.html"
first_hash="$(shasum -a 256 "$artifact_file" | awk '{print $1}')"
MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node work/build-expanded-standalone.mjs --market "$market_id"
second_hash="$(shasum -a 256 "$artifact_file" | awk '{print $1}')"
if [[ "$first_hash" != "$second_hash" ]]; then
  print -u2 "Standalone build is not deterministic: $first_hash != $second_hash"
  exit 1
fi
MACBOOK_MARKET_ID="$market_id" MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node --test tests/standalone-catalog.test.mjs

print "5/8 Preparing the exact immutable deployment artifact"
deployment_dir="$(mktemp -d "${temporary_root%/}/macbook-pages.XXXXXX")"
cp "$artifact_file" "${deployment_dir}/index.html"
deployment_hash="$(shasum -a 256 "${deployment_dir}/index.html" | awk '{print $1}')"
if [[ "$deployment_hash" != "$second_hash" ]]; then
  print -u2 "Deployment artifact does not match the tested build"
  exit 1
fi

if [[ "$prepare_only" == "true" ]]; then
  prepared_artifact_dir="$deployment_dir"
  deployment_dir=""
  workflow_succeeded=true
  print "Validated ${site_name} without changing canonical state or publishing."
  print "Prepared artifact: ${prepared_artifact_dir}/index.html"
  print "Artifact SHA-256: $second_hash"
  MACBOOK_NAMESPACE_ROOT="$staging_dir" \
    node scripts/summarize-update.mjs --market "$market_id"
  exit 0
fi

print "6/8 Syncing the private GitHub repository"
remote_url="$(git -C "$publish_dir" remote get-url origin)"
case "$remote_url" in
  "$allowed_ssh_remote"|"$allowed_https_remote"|"$allowed_https_remote_short"|"$allowed_ssh_url_remote") ;;
  *)
    print -u2 "Unexpected GitHub remote: $remote_url"
    exit 1
    ;;
esac
current_branch="$(git -C "$publish_dir" branch --show-current)"
if [[ "$current_branch" != "$publication_branch" ]]; then
  print -u2 "Expected the private checkout to be on ${publication_branch}, found: $current_branch"
  exit 1
fi
git -C "$publish_dir" fetch origin "$publication_branch"
if ! git -C "$publish_dir" merge-base --is-ancestor "origin/${publication_branch}" HEAD; then
  print -u2 "The private checkout is behind or diverged from origin/${publication_branch}"
  exit 1
fi

if [[ "$publish_dir" != "$workspace_dir" ]]; then
  for relative_file in "${retired_publication_paths[@]}"; do
    retired_target="${publish_dir}/${relative_file}"
    case "$retired_target" in
      "${publish_dir}/"*) ;;
      *)
        print -u2 "Retired publication path escaped the checkout: $relative_file"
        exit 1
        ;;
    esac
    rm -rf -- "$retired_target"
  done
  for relative_file in "${source_owned_paths[@]}"; do
    if [[ "${immutable_source_set[$relative_file]:-}" == "true" ]]; then
      source_file="${execution_root}/${relative_file}"
    else
      source_file="${staged_output_by_relative[$relative_file]:-${workspace_dir}/${relative_file}}"
    fi
    if [[ ! -f "$source_file" ]]; then
      print -u2 "Publication source is missing: $source_file"
      exit 1
    fi
    mkdir -p "${publish_dir}/${relative_file:h}"
    cp "$source_file" "${publish_dir}/${relative_file}"
  done
fi
cp "${execution_root}/config/publish.gitignore" "${publish_dir}/.gitignore"
mkdir -p "${publish_dir}/${publication_artifact_directory}"
cp "$artifact_file" "${publish_dir}/${publication_artifact_directory}/index.html"

git -C "$publish_dir" add -A -- \
  ".gitignore" \
  "${source_owned_paths[@]}" \
  "${publication_artifact_directory}/index.html"
for relative_file in "${retired_publication_paths[@]}"; do
  if git -C "$publish_dir" ls-files --error-unmatch -- \
      "$relative_file" >/dev/null 2>&1; then
    git -C "$publish_dir" add -A -- "$relative_file"
  fi
done

if ! git -C "$publish_dir" diff --cached --quiet; then
  git -C "$publish_dir" commit -m "Refresh ${site_name} catalog"
  git -C "$publish_dir" push origin "$publication_branch"
fi
publish_commit="$(git -C "$publish_dir" rev-parse HEAD)"

print "7/8 Deploying the tested artifact to the existing Cloudflare Pages project"
metadata_dir="$(mktemp -d "${temporary_root%/}/macbook-deploy-git.XXXXXX")"
git -C "$metadata_dir" init --quiet
git -C "$metadata_dir" fetch --quiet --no-tags "$publish_dir" "$publish_commit"
git -C "$metadata_dir" update-ref "refs/heads/${publication_branch}" "$publish_commit"
git -C "$metadata_dir" symbolic-ref HEAD "refs/heads/${publication_branch}"
(
  cd "$metadata_dir"
  "${workspace_dir}/node_modules/.bin/wrangler" pages deploy "$deployment_dir" \
    --project-name "$cloudflare_project" \
    --branch "$publication_branch" \
    --commit-hash "$publish_commit" \
    --commit-dirty=true
)

print "8/8 Verifying that the permanent URL serves the exact tested artifact"
live_file="${deployment_dir}/live.html"
live_matches=false
for attempt_number in {1..12}; do
  if curl -fsSL --max-time 15 \
    "${production_url}/?catalog_hash=${second_hash}" \
    -o "$live_file"; then
    live_hash="$(shasum -a 256 "$live_file" | awk '{print $1}')"
    if [[ "$live_hash" == "$second_hash" ]]; then
      live_matches=true
      break
    fi
  fi
  sleep 5
done

if [[ "$live_matches" != true ]]; then
  print -u2 "The permanent URL did not serve the tested artifact"
  exit 1
fi

promote_staged_outputs
workflow_succeeded=true
print "Catalog refresh, tests, private sync, deployment, and live hash verification succeeded."
print "Artifact SHA-256: $second_hash"
print "Production: $production_url"
MACBOOK_NAMESPACE_ROOT="$staging_dir" \
  node scripts/summarize-update.mjs --market "$market_id"
