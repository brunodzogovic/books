import DatabaseCore from 'backend/database/core';
import { assertDoesNotThrow } from 'backend/database/tests/helpers';
import { getDefaultMetaFieldValueMap } from 'backend/helpers';
import { DateTime } from 'luxon';
import { cloneDeep } from 'lodash';
import { getSchemas } from 'schemas';
import setupInstance from 'src/setup/setupInstance';
import test from 'tape';
import { getTestDbPath, getTestFyo } from './helpers';

const fyo = getTestFyo();
const dbPath = getTestDbPath();

test('setup Norwegian company', async (t) => {
  const year = DateTime.local().year;

  await assertDoesNotThrow(async () => {
    await setupInstance(
      dbPath,
      {
        logo: null,
        companyName: 'Norway Test AS',
        country: 'Norway',
        fullname: 'Test Person',
        email: 'test@example.invalid',
        bankName: 'Test Bank',
        currency: 'NOK',
        fiscalYearStart: `${year}-01-01`,
        fiscalYearEnd: `${year}-12-31`,
        chartOfAccounts: 'Norway - SME Chart of Accounts',
        organizationNumber: '123456785',
        organizationForm: 'AS',
        vatRegistered: true,
        companyAddress: 'Testveien 1',
        postalCode: '0001',
        city: 'Oslo',
      },
      fyo
    );
  }, 'Norwegian setup failed');

  t.equal(fyo.singles.SystemSettings?.currency, 'NOK');
  t.equal(fyo.singles.SystemSettings?.countryCode, 'no');
  t.equal(fyo.singles.AccountingSettings?.organizationNumber, '123456785');
  t.equal(fyo.singles.AccountingSettings?.organizationForm, 'AS');
  t.equal(fyo.singles.AccountingSettings?.vatRegistered, true);
  t.ok(
    fyo.schemaMap.Party?.fields.some(
      ({ fieldname }) => fieldname === 'organizationNumber'
    ),
    'Norwegian party schema has organization number'
  );
  t.ok(
    fyo.schemaMap.SalesInvoice?.fields.some(
      ({ fieldname }) => fieldname === 'dueDate'
    ),
    'Norwegian sales invoice schema has payment due date'
  );
  t.ok(
    fyo.schemaMap.SalesInvoice?.fields.some(
      ({ fieldname }) => fieldname === 'deliveryDate'
    ),
    'Norwegian sales invoice schema has delivery date'
  );
  t.ok(
    fyo.schemaMap.SalesInvoice?.fields.some(
      ({ fieldname }) => fieldname === 'deliveryPlace'
    ),
    'Norwegian sales invoice schema has delivery place'
  );
  t.ok(
    fyo.schemaMap.AccountingSettings?.fields.some(
      ({ fieldname }) => fieldname === 'accountingLockDate'
    ),
    'Norwegian accounting settings has period lock date'
  );
  t.ok(
    fyo.schemaMap.SalesInvoice?.fields.some(
      ({ fieldname }) => fieldname === 'cancellationReason'
    ),
    'Norwegian sales invoices record cancellation reasons'
  );
  t.ok(
    fyo.schemaMap.SalesInvoice?.fields.some(
      ({ fieldname }) => fieldname === 'correctionReason'
    ),
    'Norwegian sales credit notes have correction reason'
  );
  t.equal(
    fyo.getField('SalesInvoice', 'returnAgainst')?.label,
    'Corrects Invoice',
    'Norwegian sales credit notes expose original invoice reference'
  );
  t.ok(
    fyo.schemaMap.PurchaseInvoice?.fields.some(
      ({ fieldname }) => fieldname === 'cancellationReason'
    ),
    'Norwegian purchase invoices record cancellation reasons'
  );
  t.ok(
    fyo.schemaMap.PurchaseInvoice?.fields.some(
      ({ fieldname }) => fieldname === 'correctionReason'
    ),
    'Norwegian purchase credit notes have correction reason'
  );
  t.equal(
    fyo.getField('PurchaseInvoice', 'returnAgainst')?.label,
    'Corrects Invoice',
    'Norwegian purchase credit notes expose original invoice reference'
  );
  t.ok(
    fyo.schemaMap.Payment?.fields.some(
      ({ fieldname }) => fieldname === 'cancellationReason'
    ),
    'Norwegian payments record cancellation reasons'
  );
  t.ok(
    fyo.schemaMap.JournalEntry?.fields.some(
      ({ fieldname }) => fieldname === 'cancellationReason'
    ),
    'Norwegian journal entries record cancellation reasons'
  );

  t.ok(await fyo.db.exists('Account', 'Kundefordringer - 15000'));
  t.ok(await fyo.db.exists('Account', 'Leverandørgjeld - 24000'));
  t.ok(await fyo.db.exists('Account', 'Utgående MVA, 25 % - 27000'));
  t.ok(await fyo.db.exists('Account', 'Inngående MVA, 25 % - 27100'));
  t.ok(await fyo.db.exists('Tax', 'Utgående MVA 25 %'));
  t.ok(await fyo.db.exists('Tax', 'Inngående MVA 25 %'));
  t.ok(await fyo.db.exists('Tax', 'MVA 0 % (fritatt)'));

  const taxMappings = [
    ['Utgående MVA 25 %', 'NO-OUT-25', '3'],
    ['Utgående MVA 15 %', 'NO-OUT-15', '31'],
    ['Utgående MVA 12 %', 'NO-OUT-12', '33'],
    ['Inngående MVA 25 %', 'NO-IN-25', '1'],
    ['Inngående MVA 15 %', 'NO-IN-15', '11'],
    ['Inngående MVA 12 %', 'NO-IN-12', '13'],
    ['MVA 0 % (fritatt)', 'NO-ZERO-DOM', '5'],
    ['Unntatt MVA', 'NO-OUTSIDE', '6'],
  ];

  for (const [name, taxCode, standardTaxCode] of taxMappings) {
    const tax = await fyo.doc.getDoc('Tax', name);
    t.equal(tax?.get('taxCode'), taxCode, `${name} has stable Norwegian tax code`);
    t.equal(
      tax?.get('standardTaxCode'),
      standardTaxCode,
      `${name} maps to SAF-T standard VAT code ${standardTaxCode}`
    );
  }
});

test('Norwegian VAT metadata migrates an existing populated Tax table', async (t) => {
  const db = new DatabaseCore();
  await db.connect();

  const oldSchemaMap = cloneDeep(getSchemas('no', []));
  oldSchemaMap.Tax!.fields = oldSchemaMap.Tax!.fields.filter(
    ({ fieldname }) =>
      fieldname !== 'taxCode' && fieldname !== 'standardTaxCode'
  );

  db.setSchemaMap(oldSchemaMap);
  await db.migrate();

  await db.insert('Tax', {
    name: 'Legacy Norwegian Tax',
    ...getDefaultMetaFieldValueMap(),
  });

  db.setSchemaMap(getSchemas('no', []));
  await assertDoesNotThrow(
    async () => await db.migrate(),
    'adding Norwegian VAT metadata to an existing Tax table failed'
  );

  const rows = await db.knex!('Tax')
    .where({ name: 'Legacy Norwegian Tax' })
    .select('taxCode', 'standardTaxCode');

  t.equal(rows[0]?.taxCode, '', 'legacy Tax row receives empty taxCode default');
  t.equal(
    rows[0]?.standardTaxCode,
    '',
    'legacy Tax row receives empty SAF-T tax code default'
  );

  await db.close();
});

test.onFinish(async () => {
  await fyo.close();
});
