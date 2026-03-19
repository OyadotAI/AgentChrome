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

if [[ "$(uname)" == "Darwin" ]]; then
  log_info "Building macOS DMG (universal)"
  npm run dist:mac
fi

if [[ "$(uname)" == "Linux" ]]; then
  log_info "Building Linux AppImage"
  npm run dist:linux
fi

cd "$ROOT"

# ── Copy binaries to server/downloads ──

log_info "Copying binaries to server/downloads/"
mkdir -p server/downloads

DMG="browser/dist/Oya.Browser-${VERSION}-universal.dmg"
APPIMAGE="browser/dist/Oya.Browser-${VERSION}-arm64.AppImage"

COPIED=0
if [ -f "$DMG" ]; then
  cp "$DMG" server/downloads/
  log_ok "Copied $(basename "$DMG")"
  COPIED=$((COPIED + 1))
fi
if [ -f "$APPIMAGE" ]; then
  cp "$APPIMAGE" server/downloads/
  log_ok "Copied $(basename "$APPIMAGE")"
  COPIED=$((COPIED + 1))
fi

if [ "$COPIED" -eq 0 ]; then
  log_err "No binaries found in browser/dist/ — check build output"
  exit 1
fi

# ── Update download links in HTML ──

OLD_VERSION="${LATEST:-v1.0.0}"
OLD_VERSION="${OLD_VERSION#v}"

log_info "Updating download links: $OLD_VERSION → $VERSION"

# index.html
sed -i.bak "s/Oya\.Browser-${OLD_VERSION}-/Oya.Browser-${VERSION}-/g" server/src/public/index.html
rm -f server/src/public/index.html.bak

# docs.html
sed -i.bak "s/Oya\.Browser-${OLD_VERSION}-/Oya.Browser-${VERSION}-/g" server/src/public/docs.html
rm -f server/src/public/docs.html.bak

log_ok "Updated index.html and docs.html"

# ── Build server (minify with updated links) ──

log_info "Building server (minify assets)..."
cd "$ROOT/server"
npm run build
cd "$ROOT"
log_ok "Server built"

# ── Commit, tag, push ──

log_info "Committing version bump and link updates"
git add browser/package.json server/src/public/index.html server/src/public/docs.html
git commit -m "release: $TAG — update browser version and download links"

git tag "$TAG"
log_ok "Tagged $TAG"

git push origin "$(git branch --show-current)"
git push origin "$TAG"
log_ok "Pushed branch and tag"

# ── Create GitHub release with binaries ──

log_info "Creating GitHub release $TAG..."

RELEASE_ASSETS=""
if [ -f "$DMG" ]; then
  RELEASE_ASSETS="$RELEASE_ASSETS $DMG"
fi
if [ -f "$APPIMAGE" ]; then
  RELEASE_ASSETS="$RELEASE_ASSETS $APPIMAGE"
fi

gh release create "$TAG" $RELEASE_ASSETS \
  --title "Oya Browser $TAG" \
  --generate-notes

log_ok "GitHub release $TAG created with binaries"
log_ok "Done — prod deploy workflow triggered"
