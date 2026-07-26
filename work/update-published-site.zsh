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
expected_remote_fragment="chezzdev/macbook-refurbished-sg"

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
if [[ ! -d "${publish_dir}/.git" ]]; then
  print -u2 "Private GitHub checkout is missing: $publish_dir"
  exit 1
fi
remote_url="$(git -C "$publish_dir" remote get-url origin)"
if [[ "$remote_url" != *"$expected_remote_fragment"* ]]; then
  print -u2 "Unexpected GitHub remote: $remote_url"
  exit 1
fi
current_branch="$(git -C "$publish_dir" branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  print -u2 "Expected the private checkout to be on main, found: $current_branch"
  exit 1
fi
if ! git -C "$publish_dir" diff --cached --quiet; then
  print -u2 "The private checkout already contains staged changes; refusing to mix them"
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
    config/ranking-policy.json
    data/catalog.json
    data/featured.json
    data/site.json
    data/update-status.json
    scripts/apple-catalog-lib.mjs
    scripts/apple-catalog-lib.test.mjs
    scripts/update-exchange-rate.mjs
    scripts/update-apple-catalog.mjs
    scripts/validate-apple-catalog.mjs
    scripts/rank-models.mjs
    tests/rank-models.test.mjs
    tests/exchange-rate.test.mjs
    tests/standalone-catalog.test.mjs
    work/build-expanded-standalone.mjs
    work/update-published-site.zsh
  )
  for relative_file in "${owned_files[@]}"; do
    mkdir -p "${publish_dir}/${relative_file:h}"
    cp "${workspace_dir}/${relative_file}" "${publish_dir}/${relative_file}"
  done
fi
cp "$artifact_file" "${publish_dir}/index.html"

git -C "$publish_dir" add \
  .gitignore \
  README.md \
  index.html \
  package.json \
  package-lock.json \
  config/ranking-policy.json \
  data/catalog.json \
  data/featured.json \
  data/site.json \
  data/update-status.json \
  scripts/apple-catalog-lib.mjs \
  scripts/apple-catalog-lib.test.mjs \
  scripts/update-exchange-rate.mjs \
  scripts/update-apple-catalog.mjs \
  scripts/validate-apple-catalog.mjs \
  scripts/rank-models.mjs \
  tests/rank-models.test.mjs \
  tests/exchange-rate.test.mjs \
  tests/standalone-catalog.test.mjs \
  work/build-expanded-standalone.mjs \
  work/update-published-site.zsh

if ! git -C "$publish_dir" diff --cached --quiet; then
  git -C "$publish_dir" commit -m "Refresh deterministic MacBook catalog"
  git -C "$publish_dir" push origin main
fi

print "7/8 Deploying the tested artifact to the existing Cloudflare Pages project"
npx --yes wrangler@4.92.0 pages deploy "$deployment_dir" \
  --project-name "$cloudflare_project" \
  --branch main \
  --commit-dirty=true

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
