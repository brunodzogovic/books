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
- Export rejection when two used accounts share a numeric SAF-T AccountID,
  including accounts present only through opening balances.
- Distinct starter-chart revenue accounts and SAF-T groupings for zero-rated
  and outside-scope sales.
- Return invoices print with a distinct Credit Note / Kreditnota label.
- Sales invoices and credit notes retain a monotonic machine number sequence,
  with submitted document numbers protected from renaming and direct sales-
  invoice cancellation blocked in favor of credit-note correction.
- Cancelling a posted payment restores invoice and party outstanding balances
  while preserving original ledger entries and linked reversal entries.
- SAF-T distinguishes both sales and purchase credit notes (SCN/PCN), links
  them to corrected documents, and preserves reversed VAT semantics.
- Norwegian VAT reports expose CSV and JSON alongside SAF-T XML; CSV regression
  preserves Norwegian text and numeric values for office-suite interchange.
  Saved CSV files include a UTF-8 BOM so desktop office suites can reliably
  detect Norwegian characters without changing the in-memory CSV semantics.
- Saved Norwegian company databases reopen with regional schemas, NOK settings,
  custom SAF-T account mappings and posted ledger data intact.
- Closed database-file backup copies restore as independent company files with
  Norwegian identity, custom SAF-T mappings, ledger data and SAF-T export intact.
- Linux AppImage packaging is exercised on the self-hosted Linux Mint runner
  after the source build. CI also extracts the AppImage to verify its runtime
  structure, performs a headless packaged-app startup smoke when Xvfb is
  available, and uploads the package as a 14-day workflow artifact for testing.
- CI also emits a 14-day accountant-review artifact bundle containing the
  realistic CirreniX reference SAF-T XML, a machine-readable reconciliation
  summary, and the generated CSV/XLSX/ODS office exports. This is review
  evidence, not accountant approval.
- Negative ordinary sales invoices are blocked so reductions and reversals use
  the linked credit-note workflow and retain correction traceability.
- Bokmål regression now covers the VAT/export cockpit and Norwegian sales-
  correction messages, so the accounting localization remains usable with
  either English or Bokmål UI.
- XLSX and ODS report exports now preserve numeric cell types and Norwegian
  text in local Office Open XML / OpenDocument containers, alongside CSV/JSON.
- CI validates both spreadsheet archives structurally and, when LibreOffice is
  available on the self-hosted runner, opens and converts them headlessly while
  checking that Norwegian VAT text survives the round trip. General-ledger date
  cells retain spreadsheet-native date types in both XLSX and ODS rather than
  being flattened to plain text.

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

## Sales-document correction policy

A submitted Norwegian sales invoice is treated as issued documentation in this
localization and cannot be directly cancelled. Corrections are made with a new
credit note linked to the original document. This keeps the original document
unchanged and dates the correction as its own sales document.

The Norwegian UI hides the generic **Cancel** action for sales invoices and
renames the normal **Return** workflow to **Credit Note**. That action remains
available for a submitted original invoice even when generic invoice returns
are disabled, so the compliant correction path is directly reachable.

Negative line quantities or rates on an ordinary Norwegian sales invoice are
also rejected. Reductions and reversals must use the linked credit-note
workflow, preventing a negative invoice from bypassing the correction trail.

This is intentionally stricter than generic Frappe Books cancellation. It is
grounded in bokføringsloven § 10, which says issued documentation must not be
changed after issuance, and bokføringsforskriften § 5-2-7, which requires a
credit note when a new sales document replaces one already sent. Skatteetaten
also describes credit notes as being reported in the period in which the
correction document is issued for ordinary price reductions and similar
corrections.

The VAT summary now fails with a clear diagnostic if an older database contains
a directly-cancelled sales invoice relevant to the selected period. Such legacy
records need review rather than silently disappearing from VAT reporting.

Authoritative references:
- https://lovdata.no/lov/2004-11-19-73/§10
- https://lovdata.no/forskrift/2004-12-01-1558/§5-2-7
- https://www.skatteetaten.no/rettskilder/type/vedtak/skatteklagenemnda/fastsettelse-av-utgaende-merverdiavgift-og-ileggelse-av-tilleggsskatt-ved-manglende-bokforing-og-innberetning-av-faktura/

## Sales-document numbering checkpoint

Norwegian sales documents use Frappe Books' machine-generated NumberSeries.
The regression in `tests/testNorwayDocuments.spec.ts` verifies that invoices
receive sequential identifiers, cancellation does not recycle an assigned
identifier, credit notes continue the same sales-document sequence, and a
submitted document cannot be renamed.

This is an implementation checkpoint for the controllable numbering mechanism,
not by itself a claim that every sales-document rule is satisfied. The
authoritative numbering requirement is Bokføringsforskriften § 5-1-3:
https://lovdata.no/forskrift/2004-12-01-1558/§5-1-3

## Remaining roadmap checkpoints

Continue with acceptance evidence rather than assuming a feature is complete:

1. SAF-T maturity: additional custom-account and identifier edge cases,
   export diagnostics, and accountant review of semantic mappings.
2. Compliance traceability: connect invoicing, numbering, audit-trail,
   retention and period-control requirements to authoritative sources and
   tests; document any unresolved accounting interpretation.
3. VAT/reporting and invoice documents: verify the UI and printed output in
   English and Bokmål, distinguish a VAT summary from a filed VAT return, and
   review any legacy directly-cancelled sales documents before filing.
4. Office interoperability: CSV, ODS and XLSX report exports are implemented
   without cloud services or proprietary libraries. Continue acceptance testing
   in OnlyOffice and EuroOffice, especially number/date handling and formulas.
5. Packaging and dogfooding: install/run the produced Linux AppImage, exercise
   real UI export/save flows, and build a reviewed CirreniX reference dataset.
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
yarn test tests/testNorwayDocuments.spec.ts
yarn test tests/testNorwaySaft.spec.ts
yarn test tests/testNorwayYearEnd.spec.ts
yarn test tests/testNorwayPersistence.spec.ts
yarn build --nopackage
yarn build --nosign --linux AppImage --x64 --publish never
yarn lint
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
