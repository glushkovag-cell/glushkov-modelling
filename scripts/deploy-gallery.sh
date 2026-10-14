#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

RSYNC="${RSYNC_BIN:-/opt/homebrew/bin/rsync}"   # на Intel: /usr/local/bin/rsync
HOST="ubuntu@vps-b05d0632.vps.ovh.net"
SRC="./public/gallery/"
DST="/var/www/cms/gallery/"

OPTS=(-avz --progress
  --exclude='.DS_Store'
  --chown=www-data:www-data
  --chmod=D755,F644
  -e "ssh -p 1969"
  --rsync-path="sudo rsync")

if [[ "${1:-}" == "--dry-run" ]]; then
  OPTS+=(-n --itemize-changes)
  echo ">>> DRY RUN"
fi

"$RSYNC" "${OPTS[@]}" "$SRC" "$HOST:$DST"
echo ">>> Done"
