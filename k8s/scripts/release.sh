#!/bin/bash
# Build browser, update download links, create GitHub release, tag, and push.
# Usage: ./release.sh [version]
#   ./release.sh           — auto-increments patch (v1.0.0 → v1.0.1)
#   ./release.sh 1.2.0     — tags as v1.2.0

set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

log_info() { echo -e "\033[0;34m[INFO]\033[0m $1"; }
log_ok()   { echo -e "\033[0;32m[OK]\033[0m $1"; }
log_err()  { echo -e "\033[0;31m[ERR]\033[0m $1"; }

# ── Determine version ──

LATEST=$(git tag -l 'v*' --sort=-v:refname | head -1)

if [ -n "$1" ]; then
  VERSION="${1#v}"
  TAG="v${VERSION}"
else
  if [ -z "$LATEST" ]; then
    VERSION="1.0.0"
  else
    OLD="${LATEST#v}"
    IFS='.' read -r MAJOR MINOR PATCH <<< "$OLD"
    PATCH=$((PATCH + 1))
    VERSION="${MAJOR}.${MINOR}.${PATCH}"
  fi
  TAG="v${VERSION}"
fi

log_info "Latest tag: ${LATEST:-none}"
log_info "New tag:    $TAG"
log_info "Version:    $VERSION"
log_info "Branch:     $(git branch --show-current)"
echo ""

# ── Preflight: notarization credentials ──

# The universal build takes ~5min and notarization runs at the very end, so a
# revoked app-specific password used to cost a full build before surfacing.
log_info "Checking Apple notarization credentials"
if ! xcrun notarytool history \
  --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  >/dev/null 2>&1; then
  log_err "Apple rejected APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID."
  log_err "App-specific passwords are revoked whenever the Apple ID password changes."
  log_err "Generate a new one at appleid.apple.com and update it in ~/.zshrc."
  exit 1
fi
log_ok "Notarization credentials valid"
echo ""

read -rp "Build browser and release $TAG? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[yY]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── Update browser/package.json version ──

log_info "Updating browser/package.json version to $VERSION"
cd "$ROOT/browser"
npm version "$VERSION" --no-git-tag-version --allow-same-version
cd "$ROOT"

# ── Build browser ──

log_info "Building browser app..."
cd "$ROOT/browser"

log_info "Building macOS DMG (universal)"
npm run dist:mac

cd "$ROOT"

# ── Copy macOS binary to server/downloads ──

log_info "Copying binaries to server/downloads/"
mkdir -p server/downloads

# electron-builder outputs "Oya Browser-*" (space), download links use "Oya.Browser-*" (dot)
SRC_DMG="browser/dist/Oya Browser-${VERSION}-universal.dmg"
DST_DMG="server/downloads/Oya.Browser-${VERSION}-universal.dmg"

if [ -f "$SRC_DMG" ]; then
  cp "$SRC_DMG" "$DST_DMG"
  log_ok "Copied → $(basename "$DST_DMG")"
else
  log_err "macOS DMG not found — check build output"
  exit 1
fi

log_info "Linux AppImage will be built by GitHub Actions"

# ── Update download links in UI ──

log_info "Updating download links → $VERSION"

# Every page that links a binary, not just the landing page — the docs page was
# left out and sat three releases behind pointing at files CI no longer ships.
UI_PAGES="ui/src/app/page.tsx ui/src/app/docs/page.tsx"
for UI_PAGE in $UI_PAGES; do
  if [ -f "$UI_PAGE" ]; then
    sed -i.bak "s/Oya\.Browser-[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*-/Oya.Browser-${VERSION}-/g" "$UI_PAGE"
    rm -f "${UI_PAGE}.bak"
    log_ok "Updated $UI_PAGE"
  fi
done

# ── Commit, tag, push ──

log_info "Committing version bump and link updates"
git add browser/package.json
for UI_PAGE in $UI_PAGES; do [ -f "$UI_PAGE" ] && git add "$UI_PAGE"; done
git commit -m "release: $TAG — update browser version and download links"

git tag "$TAG"
log_ok "Tagged $TAG"

git push origin "$(git branch --show-current)"
git push origin "$TAG"
log_ok "Pushed branch and tag"

# ── Create GitHub release with binaries ──

log_info "Creating GitHub release $TAG..."

gh release create "$TAG" "$DST_DMG" \
  --title "Oya Browser $TAG" \
  --generate-notes

log_ok "GitHub release $TAG created with macOS binary"
log_ok "Linux build + prod deploy will be triggered by the tag push"
