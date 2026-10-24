import {
  getNorwegianBankStatementCsvHeaders,
  parseNorwegianBankStatementCsv,
  NorwegianBankCsvMapping,
} from 'regional/noBankStatement';
import test from 'tape';

const mapping: NorwegianBankCsvMapping = {
  bookingDate: 'Bokføringsdato',
  amount: 'Beløp',
  currency: 'Valuta',
  reference: 'Referanse',
  description: 'Tekst',
  counterpartyName: 'Motpart',
  counterpartyAccount: 'Motpartskonto',
};

test('Norwegian bank CSV normalizes common local formats', (t) => {
  const csv = [
    '\uFEFFBokføringsdato;Beløp;Valuta;Referanse;Tekst;Motpart;Motpartskonto',
    '15.09.2026;"1 234,56";NOK;KID-1001;"Konsulentoppdrag, september";Eksempel AS;"NO93 8601 1117 947"',
    '16.09.2026;"-2 500,00";NOK;HOST-42;Hosting;Leverandør AS;"NO12 3456 7890 123"',
  ].join('\r\n');

  const rows = parseNorwegianBankStatementCsv(csv, mapping);

  t.equal(rows.length, 2, 'two bank transactions are parsed');
  t.deepEqual(
    rows[0],
    {
      bookingDate: '2026-09-15',
      amount: 1234.56,
      currency: 'NOK',
      reference: 'KID-1001',
      description: 'Konsulentoppdrag, september',
      counterpartyName: 'Eksempel AS',
      counterpartyAccount: 'NO9386011117947',
      transactionId: undefined,
      occurrence: 1,
    },
    'credit transaction keeps Norwegian text and normalizes amount/date/account'
  );
  t.equal(rows[1].amount, -2500, 'debit transaction keeps its negative sign');
  t.equal(rows[1].occurrence, 1, 'unique transactions receive occurrence one');
  t.end();
});

test('Norwegian bank CSV preserves transaction ids and distinguishes identical rows', (t) => {
  const withIds = [
    'Dato;Beløp;Referanse;TransaksjonsID',
    '20.09.2026;100,00;SINV-1;BANK-001',
    '20.09.2026;100,00;SINV-1;BANK-002',
  ].join('\n');

  const idRows = parseNorwegianBankStatementCsv(withIds, {
    bookingDate: 'Dato',
    amount: 'Beløp',
    reference: 'Referanse',
    transactionId: 'TransaksjonsID',
  });

  t.equal(idRows[0].transactionId, 'BANK-001', 'bank transaction id is retained');
  t.equal(idRows[1].transactionId, 'BANK-002', 'distinct bank id is retained');

  const repeated = [
    'Dato;Beløp;Referanse;Motpart',
    '20.09.2026;100,00;SINV-1;Kunde AS',
    '20.09.2026;100,00;SINV-1;Kunde AS',
  ].join('\n');

  const repeatedRows = parseNorwegianBankStatementCsv(repeated, {
    bookingDate: 'Dato',
    amount: 'Beløp',
    reference: 'Referanse',
    counterpartyName: 'Motpart',
  });

  t.equal(repeatedRows[0].occurrence, 1, 'first identical row receives occurrence one');
  t.equal(repeatedRows[1].occurrence, 2, 'second identical row receives occurrence two');
  t.end();
});

test('Norwegian bank CSV supports ISO dates, dot decimals and default NOK', (t) => {
  const csv = [
    'Date,Amount,Reference,Description',
    '2026-09-17,1250.75,INV-2001,"Invoice 2001"',
  ].join('\n');

  const rows = parseNorwegianBankStatementCsv(
    csv,
    {
      bookingDate: 'Date',
      amount: 'Amount',
      reference: 'Reference',
      description: 'Description',
    },
    { defaultCurrency: 'NOK' }
  );

  t.equal(rows[0].bookingDate, '2026-09-17', 'ISO date is preserved');
  t.equal(rows[0].amount, 1250.75, 'dot decimal is parsed');
  t.equal(rows[0].currency, 'NOK', 'missing currency column defaults to NOK');
  t.end();
});

test('Norwegian bank CSV fails clearly on missing mapping and invalid values', (t) => {
  t.throws(
    () =>
      parseNorwegianBankStatementCsv(
        'Dato;Beløp\n20.09.2026;100,00',
        { bookingDate: 'Bokføringsdato', amount: 'Beløp' }
      ),
    /column "Bokføringsdato" was not found/,
    'missing mapped column is rejected'
  );

  t.throws(
    () =>
      parseNorwegianBankStatementCsv(
        'Dato;Beløp\n31.02.2026;abc',
        { bookingDate: 'Dato', amount: 'Beløp' }
      ),
    /invalid booking date/,
    'invalid date is rejected before import'
  );

  t.throws(
    () =>
      parseNorwegianBankStatementCsv(
        'Dato;Beløp\n20.09.2026;abc',
        { bookingDate: 'Dato', amount: 'Beløp' }
      ),
    /invalid amount/,
    'invalid amount is rejected before import'
  );
  t.end();
});


test('Norwegian bank CSV exposes headers for explicit UI mapping', (t) => {
  const csv = [
    '\uFEFFDato;Beløp;Valuta;Referanse',
    '20.09.2026;100,00;NOK;SINV-1001',
  ].join('\n');

  t.deepEqual(
    getNorwegianBankStatementCsvHeaders(csv),
    ['Dato', 'Beløp', 'Valuta', 'Referanse'],
    'header discovery uses the same delimiter and quoting rules as import'
  );
  t.end();
});

test('Norwegian bank CSV rejects ambiguous duplicate mapped headers', (t) => {
  t.throws(
    () =>
      parseNorwegianBankStatementCsv(
        'Dato;Beløp;Beløp\n20.09.2026;100,00;200,00',
        { bookingDate: 'Dato', amount: 'Beløp' }
      ),
    /column "Beløp" is ambiguous/,
    'a duplicated requested header cannot silently select the first column'
  );
  t.end();
});
