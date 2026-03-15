#!/bin/bash
# Create and push a release tag to trigger the prod deploy workflow.
# Usage: ./release.sh [version]
#   ./release.sh           — auto-increments patch (v1.0.0 → v1.0.1)
#   ./release.sh 1.2.0     — tags as v1.2.0

set -e

log_info() { echo -e "\033[0;34m[INFO]\033[0m $1"; }
log_ok()   { echo -e "\033[0;32m[OK]\033[0m $1"; }

LATEST=$(git tag -l 'v*' --sort=-v:refname | head -1)

if [ -n "$1" ]; then
  VERSION="${1#v}"
  TAG="v${VERSION}"
else
  if [ -z "$LATEST" ]; then
    TAG="v1.0.0"
  else
    VERSION="${LATEST#v}"
    IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"
    PATCH=$((PATCH + 1))
    TAG="v${MAJOR}.${MINOR}.${PATCH}"
  fi
fi

log_info "Latest tag: ${LATEST:-none}"
log_info "New tag:    $TAG"
log_info "Branch:     $(git branch --show-current)"
echo ""

read -rp "Create and push $TAG? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[yY]$ ]]; then
  echo "Aborted."
  exit 0
fi

git tag "$TAG"
git push origin "$TAG"

log_ok "Tag $TAG pushed — prod deploy workflow triggered"
