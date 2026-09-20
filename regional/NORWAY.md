# CirreniX Norwegian localization

Work on `feature/l10n-no`. The roadmap comes from **Plan norsk lokalisering**
in the **CirreniX startup** project (ChatGPT conversation
`6aaed0d9-e828-83ed-aaeb-b7e69c6c8bac`). Keep Norwegian accounting independent
of the interface language: both English and Bokmål are supported.

## Completed automated checkpoints

- Norway company setup, NOK, company identity and the open SME starter chart.
- Sales, purchases, payments, credit notes, VAT classification snapshots,
  foreign-currency NOK amounts, correction reasons and accounting locks.
- P&L and balance-sheet reconciliation, including the realistic SME year-end
  regression in `tests/testNorwayYearEnd.spec.ts`.
- SAF-T Financial 1.40: ledger and party balances, VAT information, correction
  references, period boundaries, official XSD validation and starter-chart
  grouping validation against Skatteetaten's pinned 2025–2026 codelist.
- Explicit custom-account grouping, validation and migration of existing
  account data. The account selector is available in English and Bokmål.

These are software regression checkpoints, not an accountant's approval of a
company's books or a claim of complete statutory compliance.

## Custom-account SAF-T mapping

Open **Chart of Accounts**, select an account, and set **SAF-T Grouping**.
Search by reporting code or description. The stored value identifies the
complete official category/code pair and does not change with UI language.

An explicit selection takes precedence over the existing starter-chart and
account-type defaults. An empty selection preserves those defaults. For an
account with no default mapping, export fails once the account has ledger
activity on or before the export end date, including opening-balance activity.
Unused unmapped accounts do not prevent export. Invalid stored mappings also
stop export, even if they were imported directly into the database.

Choose the classification appropriate to the account's use; the software
validates membership in the codelist, not the accounting judgment behind the
choice. Mapping changes affect subsequent exports, including exports of old
periods, and do not modify ledger entries. This follows the existing exporter
behavior of resolving account classifications at export time.

`fixtures/noSaftGroupingOptions.json` is derived from the official XML fixture
in `tests/fixtures/saft/naeringsspesifikasjon.xml`: each option stores
`GroupingCategory|GroupingCode` and displays `GroupingCode - CodeDescription`
in English. Bokmål translations use the same source's `NOB` descriptions.
The regression compares the complete set of choices with the official XML.
Provenance and checksums are in `tests/fixtures/saft/README.md`.

## Remaining roadmap checkpoints

Continue with acceptance evidence rather than assuming a feature is complete:

1. SAF-T maturity: additional custom-account and identifier edge cases,
   export diagnostics, and accountant review of semantic mappings.
2. Compliance traceability: connect invoicing, numbering, audit-trail,
   retention and period-control requirements to authoritative sources and
   tests; document any unresolved accounting interpretation.
3. VAT/reporting and invoice documents: verify the UI and printed output in
   English and Bokmål, and distinguish a VAT summary from a filed VAT return.
4. Office interoperability: CSV, ODS and XLSX workflows for OnlyOffice and
   EuroOffice, preserving numbers and non-ASCII text.
5. Packaging and dogfooding: Linux build, saved-company reopen, backup/restore,
   and a reviewed CirreniX reference dataset.
6. Later integrations: bank imports/reconciliation, EHF/Peppol, KID,
   Brønnøysund lookups and tax-authority APIs. Keep these optional adapters.

Do not copy the proprietary NS 4102 standard. The starter chart remains an
open, conventional subset. The bundled grouping list is Skatteetaten's
2025–2026 publication; do not assume it proves mappings for later reporting
years without checking the applicable official list.

## Validation

Use the Node version in `.nvmrc` and install `xmllint` (`libxml2-utils` on
Debian/Ubuntu/Linux Mint). From the repository root:

```sh
nvm use
yarn test tests/testNorwaySetup.spec.ts
yarn test tests/testNorwayAccounting.spec.ts
yarn test tests/testNorwaySaft.spec.ts
yarn test tests/testNorwayYearEnd.spec.ts
```

The XML checks use local, unmodified, pinned official fixtures and require no
network downloads. Test process errors propagate through the output formatter.
For application changes, also check `yarn build --nopackage`.

## Official sources

- [Skatteetaten SAF-T documentation](https://www.skatteetaten.no/en/business-and-organisation/start-and-run/best-practices-accounting-and-cash-register-systems/saf-t-financial/documentation/)
- [Pinned SAF-T schemas and codelists](https://github.com/Skatteetaten/saf-t/tree/05179521e435d82feb0b2d6c89a92a32a4f2d02f)

The schema check establishes XML conformance. Balance, VAT, mapping, and audit
semantics need the separate accounting assertions and human review described
above.
