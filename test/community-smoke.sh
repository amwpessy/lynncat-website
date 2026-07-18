#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <base-url>" >&2
  exit 64
fi

base_url="${1%/}"
room="XAU"
client_id="qa-community-client-$(date +%s)"
payload=$(printf '{"roomId":"XAU","nickname":"QA","text":"关注美元和实际利率","clientId":"%s"}' "$client_id")

curl --fail --silent --show-error "$base_url/markets/messages?room=$room" >/dev/null
curl --fail --silent --show-error \
  -X POST "$base_url/markets/messages" \
  -H 'content-type: application/json' \
  --data "$payload" >/dev/null
