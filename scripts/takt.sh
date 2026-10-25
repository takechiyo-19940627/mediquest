#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
# Select an existing TAKT runtime for this process only; never change nodenv global.
runtime_node=(node)
if command -v nodenv >/dev/null 2>&1; then
  export NODENV_VERSION="${TAKT_NODE_VERSION:-20.19.0}"
  runtime_node=(nodenv exec node)
fi
export NO_UPDATE_NOTIFIER=1
expected="$(cat .takt/version)"
if [[ -n "${TAKT_PACKAGE_DIR:-}" ]]; then
  # Queue adapter and actual execution must use the same reviewed installation.
  command=("${runtime_node[@]}" "$TAKT_PACKAGE_DIR/bin/takt")
else
  command=(takt)
fi
actual="$("${command[@]}" --version)"
if [[ "$actual" != "$expected" ]]; then
  echo "TAKT $expected is required (found: $actual). See .takt/README.md." >&2
  exit 1
fi
# Headless Claude inherits settings sources. Never silently broaden project preauthorization.
for arg in "$@"; do
  case "$arg" in
    run|watch|--pipeline|--issue)
      "${runtime_node[@]}" scripts/takt-local-patch.mjs verify "${TAKT_PACKAGE_DIR:?Select the reviewed local TAKT installation}"
      "${runtime_node[@]}" scripts/takt-preflight.mjs
      export MEDIQUEST_CLAUDE_EXECUTABLE="$(command -v claude)"
      MEDIQUEST_CODEX_EXECUTABLE="$("${runtime_node[@]}" scripts/codex-runtime.mjs verify "$repo_root/.takt/runtime/codex-0.163.0-darwin-arm64")"
      export MEDIQUEST_CODEX_EXECUTABLE
      export TAKT_CODEX_CLI_PATH="$repo_root/scripts/codex-scoped.mjs"
      export TAKT_CLAUDE_CLI_PATH="$repo_root/scripts/claude-trusted.mjs"
      break
      ;;
  esac
done
exec "${command[@]}" "$@"
