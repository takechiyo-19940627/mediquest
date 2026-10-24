#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo 'Provide exactly one approved app operation.' >&2
  exit 2
fi
case "$1" in
  ci|format|format:check|lint|typecheck|test:unit|test:integration|test:e2e|build|dev|browser:install|quality|versions) ;;
  *) echo 'Unsupported app operation.' >&2; exit 2 ;;
esac
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
export NODENV_VERSION=24.15.0
export npm_config_cache="$repo_root/app/.cache/npm"
export PLAYWRIGHT_BROWSERS_PATH="$repo_root/app/.cache/ms-playwright"
if [[ "$(nodenv exec node --version)" != 'v24.15.0' ]]; then
  echo 'Node 24.15.0 is required.' >&2
  exit 1
fi
case "$1" in
  ci) exec nodenv exec npm --prefix app ci ;;
  browser:install) exec nodenv exec node app/node_modules/playwright/cli.js install chromium ;;
  quality) exec nodenv exec node scripts/check-app.mjs ;;
  versions) nodenv exec node --version; exec nodenv exec npm --version ;;
  *) exec nodenv exec npm --prefix app run "$1" ;;
esac
