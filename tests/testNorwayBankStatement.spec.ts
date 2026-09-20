import {
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
    },
    'credit transaction keeps Norwegian text and normalizes amount/date/account'
  );
  t.equal(rows[1].amount, -2500, 'debit transaction keeps its negative sign');
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
