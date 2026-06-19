#!/usr/bin/env bash
# PostToolUse hook. Fires after string_replace_lsp / ast_smart_edit / write_file.
# If the tool touched a source file under apps/internal AND the new content
# contains a Lingui macro, nudge the agent to run extract + fill translations.

set -euo pipefail

json=$(cat)
file_path=$(echo "$json" | jq -r '.tool_input.path // empty')

case "$file_path" in
	*apps/internal/src/*.tsx | *apps/internal/src/*.ts) app=internal ;;
	*) exit 0 ;;
esac

# string_replace_lsp uses new_string; write_file uses content
content=$(echo "$json" | jq -r '.tool_input.new_string // .tool_input.content // empty')
[ -n "$content" ] || exit 0

if echo "$content" | grep -qE '(<Trans[[:space:]>/]|useLingui\(|msg`|@lingui/(core|react)/macro)'; then
	cat <<EOF
{"systemMessage": "Lingui macro touched in apps/$app. Before ending the turn: run \`pnpm -F @batuda/$app i18n:extract\`, translate new msgids in non-en messages.po, then \`pnpm -F @batuda/$app i18n:check\` to confirm no missing translations."}
EOF
fi
