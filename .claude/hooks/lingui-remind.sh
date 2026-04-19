#!/usr/bin/env bash
# PostToolUse hook. Fires after Edit/Write. If the tool touched a source file
# under a web app AND the new content contains a Lingui macro, nudge the agent
# to run extract + fill non-en translations before finishing the turn.

set -euo pipefail

json=$(cat)
file_path=$(echo "$json" | jq -r '.tool_input.file_path // empty')

case "$file_path" in
	*apps/internal/src/*.tsx | *apps/internal/src/*.ts) app=internal ;;
	*) exit 0 ;;
esac

content=$(echo "$json" | jq -r '.tool_input.new_string // .tool_input.content // empty')
[ -n "$content" ] || exit 0

if echo "$content" | grep -qE '(<Trans[[:space:]>/]|useLingui\(|msg`|@lingui/(core|react)/macro)'; then
	cat <<EOF
{"systemMessage": "Lingui macro touched in apps/$app. Before ending the turn: run \`pnpm -F @engranatge/$app i18n:extract\`, translate new msgids in non-en messages.po, then \`pnpm -F @engranatge/$app i18n:check\` to confirm no missing translations."}
EOF
fi
