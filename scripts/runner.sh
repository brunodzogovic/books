#!/usr/bin/env bash
set -euo pipefail

# Use Electron's bundled Node runtime to prevent a NODE_MODULE_VERSION
# mismatch when loading native modules such as better-sqlite3.
export TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'
export ELECTRON_RUN_AS_NODE=true

exec ./node_modules/.bin/electron \
  --require ts-node/register \
  --require tsconfig-paths/register \
  "$@"
