#!/usr/bin/env bash
set -euo pipefail

PACKAGE=0
if [[ "${1:-}" == "--package" ]]; then
  PACKAGE=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: yarn norway:verify [--package]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Norwegian localization verification ==="
echo "Node: $(node --version)"
echo "Yarn: $(yarn --version)"

if ! command -v xmllint >/dev/null 2>&1; then
  echo "ERROR: xmllint is required (Linux Mint/Ubuntu: sudo apt install libxml2-utils)." >&2
  exit 1
fi

TESTS=(
  tests/testNorwaySetup.spec.ts
  tests/testNorwayAccounting.spec.ts
  tests/testNorwayDocuments.spec.ts
  tests/testNorwayDiscounts.spec.ts
  tests/testNorwayExports.spec.ts
  tests/testNorwaySaft.spec.ts
  tests/testNorwayYearEnd.spec.ts
  tests/testNorwayBankStatement.spec.ts
  tests/testNorwayBankReconciliation.spec.ts
  tests/testNorwayPersistence.spec.ts
  models/baseModels/tests/testPayment.spec.ts
)

for test_file in "${TESTS[@]}"; do
  echo
  echo "=== $test_file ==="
  yarn test "$test_file"
done

echo
echo "=== Application build ==="
yarn build --nopackage

echo
echo "=== Lint ==="
yarn lint

if [[ "$PACKAGE" -eq 1 ]]; then
  echo
  echo "=== Linux AppImage package ==="
  yarn build --nosign --linux AppImage --x64 --publish never
fi

echo
echo "=== NORWAY VERIFY: PASS ==="
