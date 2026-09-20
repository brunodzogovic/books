import DatabaseCore from 'backend/database/core';
import { promises as fs } from 'fs';
import path from 'path';
import { translateSchema } from 'fyo/utils/translation';
import { OptionField } from 'schemas/types';
import { parseCSV } from 'utils/csvParser';
import { schemaTranslateables } from 'utils/translationHelpers';
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
  t.equal(
    fyo.getField('Account', 'saftGrouping')?.fieldtype,
    'AutoComplete',
    'Norwegian accounts expose a searchable SAF-T grouping choice'
  );
  t.ok(
    fyo.schemaMap.Account?.quickEditFields?.includes('saftGrouping'),
    'SAF-T grouping can be edited from Chart of Accounts'
  );
  t.notOk(
    getSchemas('in', []).Account?.fields.some(
      ({ fieldname }) => fieldname === 'saftGrouping'
    ),
    'SAF-T grouping does not affect non-Norwegian account schemas'
  );
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
    fyo.schemaMap.SalesInvoiceItem?.fields.some(
      ({ fieldname }) => fieldname === 'norwegianVatSnapshot'
    ),
    'Norwegian sales invoice items snapshot VAT mapping'
  );
  t.ok(
    fyo.schemaMap.PurchaseInvoiceItem?.fields.some(
      ({ fieldname }) => fieldname === 'norwegianVatSnapshot'
    ),
    'Norwegian purchase invoice items snapshot VAT mapping'
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
    t.equal(
      tax?.get('taxCode'),
      taxCode,
      `${name} has stable Norwegian tax code`
    );
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

  t.equal(
    rows[0]?.taxCode,
    '',
    'legacy Tax row receives empty taxCode default'
  );
  t.equal(
    rows[0]?.standardTaxCode,
    '',
    'legacy Tax row receives empty SAF-T tax code default'
  );

  await db.close();
});

test('Norwegian SAF-T choices keep stable codes in English and Bokmål', async (t) => {
  const schemas = cloneDeep(getSchemas('no', []));
  const field = schemas.Account!.fields.find(
    ({ fieldname }) => fieldname === 'saftGrouping'
  ) as OptionField;
  const englishValues = field.options.map(({ value }) => value);
  t.equal(
    field.options.find(({ value }) => value === 'annenDriftskostnad|6700')
      ?.label,
    '6700 - Accountancy and consultancy services, etc.',
    'English UI has the official English grouping description'
  );
  const csv = await fs.readFile(
    path.join(__dirname, '../translations/nb-NO.csv'),
    'utf8'
  );
  const languageMap = Object.fromEntries(
    parseCSV(csv).map(([source, translation]) => [source, { translation }])
  );
  translateSchema(schemas, languageMap, schemaTranslateables);
  t.equal(
    field.label,
    'SAF-T-gruppering',
    'Bokmål UI translates the field label'
  );
  t.equal(
    field.options.find(({ value }) => value === 'annenDriftskostnad|6700')
      ?.label,
    '6700 - Regnskapstjenester, rådgivning med mer',
    'Bokmål UI has the official Norwegian grouping description'
  );
  t.deepEqual(
    field.options.map(({ value }) => value),
    englishValues,
    'changing UI language preserves every accounting mapping value'
  );
});

test('Norwegian SAF-T grouping migrates existing account data', async (t) => {
  const db = new DatabaseCore();
  await db.connect();
  try {
    const oldSchemaMap = cloneDeep(getSchemas('no', []));
    oldSchemaMap.Account!.fields = oldSchemaMap.Account!.fields.filter(
      ({ fieldname }) => fieldname !== 'saftGrouping'
    );
    db.setSchemaMap(oldSchemaMap);
    await db.migrate();
    await db.insert('Account', {
      name: 'Legacy custom account',
      rootType: 'Expense',
      lft: 0,
      rgt: 0,
      isGroup: false,
      ...getDefaultMetaFieldValueMap(),
    });
    db.setSchemaMap(getSchemas('no', []));
    await db.migrate();
    const account = await db.get('Account', 'Legacy custom account');
    t.equal(
      account.saftGrouping,
      '',
      'existing accounts receive an empty mapping'
    );
    t.equal(
      account.rootType,
      'Expense',
      'migration preserves existing account data'
    );
  } finally {
    await db.close();
  }
});

test.onFinish(async () => {
  await fyo.close();
});
