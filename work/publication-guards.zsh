#!/bin/zsh

publication_remote_matches() {
  local actual_remote="$1"
  local expected_remote="$2"
  local expected_https="${expected_remote/git@github.com:/https://github.com/}"
  local expected_https_short="${expected_https%.git}"
  local expected_ssh_url="${expected_remote/git@github.com:/ssh://git@github.com/}"

  case "$actual_remote" in
    "$expected_remote"|"$expected_https"|"$expected_https_short"|"$expected_ssh_url")
      return 0
      ;;
  esac
  return 1
}

publication_require_remote_and_branch() {
  local checkout_dir="$1"
  local expected_remote="$2"
  local expected_branch="$3"
  local actual_remote
  local current_branch

  actual_remote="$(git -C "$checkout_dir" remote get-url origin)"
  if ! publication_remote_matches "$actual_remote" "$expected_remote"; then
    print -u2 "Unexpected publication remote: $actual_remote"
    return 1
  fi
  current_branch="$(git -C "$checkout_dir" branch --show-current)"
  if [[ "$current_branch" != "$expected_branch" ]]; then
    print -u2 \
      "Expected publication branch ${expected_branch}, found: ${current_branch:-detached HEAD}"
    return 1
  fi
}

publication_fetch_and_require_remote_head() {
  local checkout_dir="$1"
  local expected_branch="$2"
  local local_head
  local remote_head

  git -C "$checkout_dir" fetch --quiet origin "$expected_branch"
  local_head="$(git -C "$checkout_dir" rev-parse HEAD)"
  remote_head="$(
    git -C "$checkout_dir" rev-parse \
      "refs/remotes/origin/${expected_branch}^{commit}"
  )"
  if [[ "$local_head" != "$remote_head" ]]; then
    print -u2 \
      "Publication HEAD must exactly match origin/${expected_branch}: ${local_head} != ${remote_head}"
    return 1
  fi
}

publication_require_clean_synced_checkout() {
  local checkout_dir="$1"
  local expected_remote="$2"
  local expected_branch="$3"
  local checkout_changes

  if ! git -C "$checkout_dir" rev-parse \
      --is-inside-work-tree >/dev/null 2>&1; then
    print -u2 "Publication checkout is missing: $checkout_dir"
    return 1
  fi
  checkout_changes="$(
    git -C "$checkout_dir" status --porcelain=v1 --untracked-files=all
  )"
  if [[ -n "$checkout_changes" ]]; then
    print -u2 "Publication checkout must be completely clean:"
    print -u2 "$checkout_changes"
    return 1
  fi
  publication_require_remote_and_branch \
    "$checkout_dir" "$expected_remote" "$expected_branch" || return 1
  publication_fetch_and_require_remote_head \
    "$checkout_dir" "$expected_branch" || return 1
}

publication_cached_path_is_allowed() {
  local relative_file="$1"
  shift
  local allowed_entry

  for allowed_entry in "$@"; do
    if [[ "$relative_file" == "$allowed_entry" ]]; then
      return 0
    fi
  done
  return 1
}

publication_cached_path_is_retired() {
  local relative_file="$1"
  shift
  local retired_entry

  for retired_entry in "$@"; do
    if [[ "$relative_file" == "$retired_entry" || \
          "$relative_file" == "${retired_entry}/"* ]]; then
      return 0
    fi
  done
  return 1
}

publication_require_cached_paths() {
  local checkout_dir="$1"
  shift
  local -a allowed_entries=()
  local -a retired_entries=()
  local entry_group="allowed"
  local manifest_entry
  local unstaged_changes
  local untracked_files
  local cached_change_code
  local relative_file

  for manifest_entry in "$@"; do
    if [[ "$manifest_entry" == "--retired" ]]; then
      entry_group="retired"
    elif [[ "$entry_group" == "allowed" ]]; then
      allowed_entries+=("$manifest_entry")
    else
      retired_entries+=("$manifest_entry")
    fi
  done
  unstaged_changes="$(git -C "$checkout_dir" diff --name-status)"
  if [[ -n "$unstaged_changes" ]]; then
    print -u2 "Publication checkout has unstaged changes:"
    print -u2 "$unstaged_changes"
    return 1
  fi
  untracked_files="$(
    git -C "$checkout_dir" ls-files --others --exclude-standard
  )"
  if [[ -n "$untracked_files" ]]; then
    print -u2 "Publication checkout has untracked files:"
    print -u2 "$untracked_files"
    return 1
  fi
  if ! git -C "$checkout_dir" diff --cached --check; then
    print -u2 "Publication index contains whitespace errors."
    return 1
  fi
  while IFS= read -r -d '' cached_change_code; do
    if ! IFS= read -r -d '' relative_file; then
      print -u2 "Publication index contains malformed cached path data."
      return 1
    fi
    if publication_cached_path_is_retired \
        "$relative_file" "${retired_entries[@]}"; then
      if [[ "$cached_change_code" != "D" ]]; then
        print -u2 \
          "Publication index may only delete retired paths: $relative_file"
        return 1
      fi
    elif ! publication_cached_path_is_allowed \
        "$relative_file" "${allowed_entries[@]}"; then
      print -u2 \
        "Publication index contains a path outside the manifest: $relative_file"
      return 1
    fi
  done < <(
    git -C "$checkout_dir" diff --cached --name-status -z --no-renames
  )
}
