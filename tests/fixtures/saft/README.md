# Norwegian SAF-T Financial 1.40 test schema

`Norwegian_SAF-T_Financial_Schema_v_1.40.xsd` is an unmodified copy of
Skatteetaten's official schema, including its copyright and version metadata.
It is pinned to the same revision previously downloaded by the SAF-T tests:

- Repository: https://github.com/Skatteetaten/saf-t
- Commit: `05179521e435d82feb0b2d6c89a92a32a4f2d02f`
- Source: https://raw.githubusercontent.com/Skatteetaten/saf-t/05179521e435d82feb0b2d6c89a92a32a4f2d02f/SAF-T_Financial_1.4/Norwegian_SAF-T_Financial_Schema_v_1.40.xsd
- SHA-256: `0e2f33c825612ea45f991b4a04039c63eae070df7da10fecab18fd043d4f2128`

The shared validator in `tests/saftTestHelpers.ts` uses this local copy with
`xmllint --nonet`, so validation requires no network access. Do not reformat
the schema. When deliberately updating it, record the new upstream revision
and checksum here and run both the SAF-T and year-end suites.

## Local Norwegian regression checks

Install `xmllint` (the `libxml2-utils` package on Debian/Ubuntu/Linux Mint),
then run from the repository root:

```sh
nvm use
yarn test tests/testNorwaySetup.spec.ts
yarn test tests/testNorwayAccounting.spec.ts
yarn test tests/testNorwaySaft.spec.ts
yarn test tests/testNorwayYearEnd.spec.ts
```

The SAF-T and year-end suites fail if the validator is unavailable or an export
does not validate. Passing the schema check verifies XML structure; the
accounting assertions separately check balances, VAT, and correction history.
