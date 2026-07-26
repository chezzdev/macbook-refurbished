#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
workspace_dir="${script_dir:h}"
publish_dir="${MACBOOK_PUBLISH_DIR:-${workspace_dir}/work/gh-pages-site}"
publish_dir="${publish_dir:A}"
temporary_root="${TMPDIR:-/tmp}"
temporary_root="${temporary_root:A}"
deployment_dir=""

cleanup() {
  exit_code=$?
  set +e
  if [[ -n "$deployment_dir" && -d "$deployment_dir" && \
        "$deployment_dir" == "${temporary_root%/}/macbook-unified-fallback."* ]]; then
    rm -rf -- "$deployment_dir"
  fi
  return "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -d "${publish_dir}/.git" ]]; then
  print -u2 "Unified publication checkout is missing: ${publish_dir}"
  exit 1
fi
if [[ ! -x "${workspace_dir}/node_modules/.bin/wrangler" ]]; then
  print -u2 "Pinned Wrangler is missing; run npm ci in ${workspace_dir}"
  exit 1
fi

required_files=(
  ".nojekyll"
  "index.html"
  "markets/sg/index.html"
  "markets/us/index.html"
)
for relative_file in "${required_files[@]}"; do
  if [[ ! -f "${publish_dir}/${relative_file}" ]]; then
    print -u2 "Unified publication file is missing: ${relative_file}"
    exit 1
  fi
done

publication_changes="$(
  git -C "$publish_dir" status --porcelain --untracked-files=all -- \
    "${required_files[@]}"
)"
if [[ -n "$publication_changes" ]]; then
  print -u2 "Unified publication checkout has uncommitted site changes:"
  print -u2 "$publication_changes"
  exit 1
fi

deployment_dir="$(
  mktemp -d "${temporary_root%/}/macbook-unified-fallback.XXXXXX"
)"
deployment_dir="${deployment_dir:A}"
cp "${publish_dir}/.nojekyll" "${deployment_dir}/.nojekyll"
cp "${publish_dir}/index.html" "${deployment_dir}/index.html"
mkdir -p "${deployment_dir}/markets/sg" "${deployment_dir}/markets/us"
cp "${publish_dir}/markets/sg/index.html" \
  "${deployment_dir}/markets/sg/index.html"
cp "${publish_dir}/markets/us/index.html" \
  "${deployment_dir}/markets/us/index.html"

sg_hash="$(shasum -a 256 "${deployment_dir}/markets/sg/index.html" | awk '{print $1}')"
us_hash="$(shasum -a 256 "${deployment_dir}/markets/us/index.html" | awk '{print $1}')"
publish_commit="$(git -C "$publish_dir" rev-parse HEAD)"

fallback_projects=(
  "macbook-sg-refurbished|https://macbook-sg-refurbished.pages.dev"
  "macbook-us-refurbished|https://macbook-us-refurbished.pages.dev"
)

for fallback_target in "${fallback_projects[@]}"; do
  IFS="|" read -r cloudflare_project production_url <<< "$fallback_target"
  print "Deploying unified fallback to ${cloudflare_project}"
  (
    cd "$publish_dir"
    "${workspace_dir}/node_modules/.bin/wrangler" pages deploy "$deployment_dir" \
      --project-name "$cloudflare_project" \
      --branch main \
      --commit-hash "$publish_commit" \
      --commit-dirty=true
  )

  for market_id in sg us; do
    if [[ "$market_id" == "sg" ]]; then
      expected_hash="$sg_hash"
    else
      expected_hash="$us_hash"
    fi
    live_file="${deployment_dir}/live-${cloudflare_project}-${market_id}.html"
    live_matches=false
    attempt_number=1
    while (( attempt_number <= 12 )); do
      if curl -fsSL --max-time 15 \
        "${production_url}/markets/${market_id}/?catalog_hash=${expected_hash}" \
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
      print -u2 "${production_url}/markets/${market_id}/ did not serve the tested artifact"
      exit 1
    fi
  done
done

print "Unified Cloudflare fallback deployment and live verification succeeded."
