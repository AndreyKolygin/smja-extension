#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Determine version from manifest.json via Node (falls back to grep).
if command -v node >/dev/null 2>&1; then
  VERSION="$(node -e "process.stdout.write(require('./manifest.json').version || '')")"
else
  VERSION="$(grep -oE '\"version\"\\s*:\\s*\"[^\"]+\"' manifest.json | head -n1 | cut -d'\"' -f4)"
fi

if [[ -z "${VERSION}" ]]; then
  echo "Cannot determine version from manifest.json" >&2
  exit 1
fi

DIST_DIR="$ROOT/dist"
STAGING_DIR="$DIST_DIR/jda-extension"
ARCHIVE_NAME="jda-extension-${VERSION}.zip"

rm -rf "$DIST_DIR"
mkdir -p "$STAGING_DIR"

copy_tree() {
  local src="$1"
  local dst="$STAGING_DIR/$1"
  if [[ -e "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -R "$src" "$dst"
  fi
}

# Core extension assets
copy_tree "background"
copy_tree "content"
copy_tree "shared"
copy_tree "ui"
copy_tree "icons"
cp manifest.json "$STAGING_DIR/"

# Optional docs for offline reference
cp README.md README.ru.md QUICKSTART.md "$STAGING_DIR/" 2>/dev/null || true

(
  cd "$STAGING_DIR"
  zip -qr "../${ARCHIVE_NAME}" . -x "*.DS_Store" -x "_metadata/*"
)

rm -rf "$STAGING_DIR"

echo "Created dist/${ARCHIVE_NAME}"
