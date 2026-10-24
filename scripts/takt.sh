#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
# Select an existing TAKT runtime for this process only; never change nodenv global.
if command -v nodenv >/dev/null 2>&1; then
  export NODENV_VERSION="${TAKT_NODE_VERSION:-20.19.0}"
fi
export NO_UPDATE_NOTIFIER=1
expected="$(cat .takt/version)"
actual="$(takt --version)"
if [[ "$actual" != "$expected" ]]; then
  echo "TAKT $expected is required (found: $actual). See .takt/README.md." >&2
  exit 1
fi
exec takt "$@"
