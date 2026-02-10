#!/usr/bin/env bash
set -euo pipefail

FILES=(
  "src/components/chat/MessageContent.tsx"
  "src/components/chat/ChatArea.tsx"
  "src/app/dm/[recipientId]/page.tsx"
  "src/app/channels/me/[recipientId]/page.tsx"
)

PATTERN='max-w-md[[:space:]]+max-h-80|max-h-80[[:space:]]+max-w-md'

if rg -n --pcre2 "$PATTERN" "${FILES[@]}"; then
  echo "Found hardcoded media sizing tokens in chat surfaces. Use .chat-media and CSS variables instead."
  exit 1
fi

echo "Chat media hardcoded-token check passed."
