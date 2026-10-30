# Process test fixtures

This private package pins upstream TAKT 0.49.0 and Codex SDK 0.137.0 sources for
process regression tests. It is independent of the application dependencies and
is not a provider runtime. The SDK override keeps TAKT's dependency on the same
reviewed version; source SHA-256 checks in the patchers remain mandatory.

From the repository root, with Node 22:

```sh
npm ci --prefix scripts/process-checks --ignore-scripts --no-audit --no-fund
TAKT_SOURCE="$PWD/scripts/process-checks/node_modules/takt" \
CODEX_SDK_SOURCE="$PWD/scripts/process-checks/node_modules/@openai/codex-sdk/dist/index.js" \
node --test scripts/*.test.mjs
```

The runtime test builds a disposable fixture from these unmodified published
sources, including the SDK manifest. It does not depend on an existing patched
TAKT installation. Missing dependencies, changed versions or unknown source
hashes fail the tests; they do not skip them. Installation disables lifecycle
scripts because only package source files are needed.
