#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
workspace_dir="${script_dir:h}"
default_publish_dir="${script_dir}/gh-pages-site"
lock_dir="${script_dir}/.catalog-update.lock"
temporary_root="${TMPDIR:-/tmp}"
deployment_dir=""
production_url="https://macbook-sg-refurbished.pages.dev"
cloudflare_project="macbook-sg-refurbished"
allowed_ssh_remote="git@github.com:chezzdev/macbook-refurbished-sg.git"
allowed_https_remote="https://github.com/chezzdev/macbook-refurbished-sg.git"

publish_owned_paths=(
  .gitignore
  README.md
  index.html
  package.json
  package-lock.json
  config/publish.gitignore
  config/ranking-policy.json
  data/catalog.json
  data/featured.json
  data/site.json
  data/update-status.json
  scripts/apple-catalog-lib.mjs
  scripts/apple-catalog-lib.test.mjs
  scripts/html-escape.mjs
  scripts/update-apple-catalog.mjs
  scripts/update-exchange-rate.mjs
  scripts/validate-apple-catalog.mjs
  scripts/rank-models.mjs
  tests/exchange-rate.test.mjs
  tests/html-escape.test.mjs
  tests/rank-models.test.mjs
  tests/standalone-catalog.test.mjs
  work/build-expanded-standalone.mjs
  work/update-published-site.zsh
)

if [[ -d "${workspace_dir}/.git" && \
      -f "${workspace_dir}/scripts/update-apple-catalog.mjs" && \
      ! -d "${default_publish_dir}/.git" ]]; then
  publish_dir="$workspace_dir"
else
  publish_dir="$default_publish_dir"
fi

cleanup() {
  if [[ -n "$deployment_dir" && -d "$deployment_dir" && \
        "$deployment_dir" == "${temporary_root%/}/macbook-pages."* ]]; then
    rm -rf -- "$deployment_dir"
  fi
  rmdir "$lock_dir" 2>/dev/null || true
}

if ! mkdir "$lock_dir" 2>/dev/null; then
  print -u2 "Another catalog update is already running: $lock_dir"
  exit 1
fi
trap cleanup EXIT INT TERM

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

cd "$workspace_dir"

print "1/8 Fetching Apple Singapore prices and the current SGD to USD rate"
node scripts/update-apple-catalog.mjs
node scripts/validate-apple-catalog.mjs
node scripts/update-exchange-rate.mjs

print "2/8 Applying deterministic ranking policy"
node scripts/rank-models.mjs
node scripts/rank-models.mjs --check

print "3/8 Running parser, currency, and ranking tests"
node --test \
  scripts/apple-catalog-lib.test.mjs \
  tests/exchange-rate.test.mjs \
  tests/html-escape.test.mjs \
  tests/rank-models.test.mjs

print "4/8 Building the standalone page twice"
node work/build-expanded-standalone.mjs
artifact_file="${workspace_dir}/outputs/macbook-air-refurbished-comparison.html"
first_hash="$(shasum -a 256 "$artifact_file" | awk '{print $1}')"
node work/build-expanded-standalone.mjs
second_hash="$(shasum -a 256 "$artifact_file" | awk '{print $1}')"
if [[ "$first_hash" != "$second_hash" ]]; then
  print -u2 "Standalone build is not deterministic: $first_hash != $second_hash"
  exit 1
fi
node --test tests/standalone-catalog.test.mjs

print "5/8 Preparing the exact immutable deployment artifact"
deployment_dir="$(mktemp -d "${temporary_root%/}/macbook-pages.XXXXXX")"
cp "$artifact_file" "${deployment_dir}/index.html"
deployment_hash="$(shasum -a 256 "${deployment_dir}/index.html" | awk '{print $1}')"
if [[ "$deployment_hash" != "$second_hash" ]]; then
  print -u2 "Deployment artifact does not match the tested build"
  exit 1
fi

print "6/8 Syncing the private GitHub repository"
remote_url="$(git -C "$publish_dir" remote get-url origin)"
case "$remote_url" in
  "$allowed_ssh_remote"|"$allowed_https_remote") ;;
  *)
    print -u2 "Unexpected GitHub remote: $remote_url"
    exit 1
    ;;
esac
current_branch="$(git -C "$publish_dir" branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  print -u2 "Expected the private checkout to be on main, found: $current_branch"
  exit 1
fi
git -C "$publish_dir" fetch origin main
if ! git -C "$publish_dir" merge-base --is-ancestor origin/main HEAD; then
  print -u2 "The private checkout is behind or diverged from origin/main"
  exit 1
fi

if [[ "$publish_dir" != "$workspace_dir" ]]; then
  owned_files=(
    README.md
    package.json
    package-lock.json
    config/publish.gitignore
    config/ranking-policy.json
    data/catalog.json
    data/featured.json
    data/site.json
    data/update-status.json
    scripts/apple-catalog-lib.mjs
    scripts/apple-catalog-lib.test.mjs
    scripts/html-escape.mjs
    scripts/update-exchange-rate.mjs
    scripts/update-apple-catalog.mjs
    scripts/validate-apple-catalog.mjs
    scripts/rank-models.mjs
    tests/rank-models.test.mjs
    tests/exchange-rate.test.mjs
    tests/html-escape.test.mjs
    tests/standalone-catalog.test.mjs
    work/build-expanded-standalone.mjs
    work/update-published-site.zsh
  )
  for relative_file in "${owned_files[@]}"; do
    mkdir -p "${publish_dir}/${relative_file:h}"
    cp "${workspace_dir}/${relative_file}" "${publish_dir}/${relative_file}"
  done
  cp "${workspace_dir}/config/publish.gitignore" "${publish_dir}/.gitignore"
fi
cp "$artifact_file" "${publish_dir}/index.html"

git -C "$publish_dir" add -- "${publish_owned_paths[@]}"

if ! git -C "$publish_dir" diff --cached --quiet; then
  git -C "$publish_dir" commit -m "Refresh deterministic MacBook catalog"
  git -C "$publish_dir" push origin main
fi
publish_commit="$(git -C "$publish_dir" rev-parse HEAD)"

print "7/8 Deploying the tested artifact to the existing Cloudflare Pages project"
git -C "$deployment_dir" init --quiet
git -C "$deployment_dir" fetch --quiet --no-tags "$publish_dir" "$publish_commit"
git -C "$deployment_dir" update-ref refs/heads/main "$publish_commit"
git -C "$deployment_dir" symbolic-ref HEAD refs/heads/main
(
  cd "$deployment_dir"
  npx --yes wrangler@4.92.0 pages deploy . \
    --project-name "$cloudflare_project" \
    --branch main \
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

print "Catalog refresh, tests, private sync, deployment, and live hash verification succeeded."
print "Artifact SHA-256: $second_hash"
print "Production: $production_url"
