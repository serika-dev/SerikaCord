#!/usr/bin/env bash
set -euo pipefail

FILES=(
  "src/app/layout.tsx"
  "src/app/channels/layout.tsx"
  "src/components/layout/ServerSidebar.tsx"
  "src/components/layout/ChannelSidebar.tsx"
  "src/components/chat/ChatArea.tsx"
  "src/app/channels/[serverId]/page.tsx"
  "src/app/channels/[serverId]/[channelId]/page.tsx"
  "src/app/channels/me/page.tsx"
  "src/app/channels/settings/page.tsx"
  "src/app/channels/settings/[section]/page.tsx"
  "src/app/channels/settings/account/page.tsx"
)

PATTERN='className="dark"|bg-\[#000000\]|bg-\[#0a0a0a\]|bg-\[#111111\]|bg-\[#1a1a1a\]|border-\[#1a1a1a\]|border-\[#222222\]|hover:bg-\[#1a1a1a\]|hover:bg-\[#111111\]|border-\[#0a0a0a\]'

if rg -n --pcre2 "$PATTERN" "${FILES[@]}"; then
  echo "Found hardcoded dark theme tokens in critical shell files."
  exit 1
fi

echo "Theme hardcoded-token check passed."
