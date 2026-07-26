#!/bin/zsh
set -uo pipefail

script_dir="${0:A:h}"
workspace_dir="${script_dir:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$workspace_dir"
if "${workspace_dir}/work/update-published-site.zsh"; then
  summary_file="${workspace_dir}/outputs/latest-update-summary.txt"
  temporary_summary_file="${summary_file}.tmp"
  node scripts/summarize-update.mjs > "$temporary_summary_file"
  mv "$temporary_summary_file" "$summary_file"
  summary_text="$(node scripts/summarize-update.mjs --compact)"
  print "$summary_text"
  /usr/bin/osascript - "$summary_text" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run suppliedArguments
  display notification (item 1 of suppliedArguments) with title "MacBook Refurbished SG"
end run
APPLESCRIPT
else
  update_exit_code=$?
  /usr/bin/osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
display notification "Обновление не завершено — проверьте журнал запуска." with title "MacBook Refurbished SG"
APPLESCRIPT
  exit "$update_exit_code"
fi
