import setupInstance from 'src/setup/setupInstance';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { ModelNameEnum } from 'models/types';
import {
  buildNorwegianSaftFinancial140,
  getSaftAccountId,
  NORWEGIAN_SAF_T_VERSION,
} from 'regional/noSaft';
import test from 'tape';
import { getTestDbPath, getTestFyo } from './helpers';

const fyo = getTestFyo();
const dbPath = getTestDbPath();

test('Norwegian SAF-T Financial 1.40 exports balanced general ledger', async (t) => {
  const year = new Date().getFullYear();

  await setupInstance(
    dbPath,
    {
      logo: null,
      companyName: 'SAF-T Test & Company AS',
      country: 'Norway',
      fullname: 'Test Person',
      email: 'saft@example.invalid',
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

  const customer = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: 'SAF-T Testkunde AS',
    role: 'Customer',
    email: 'kunde@example.invalid',
    organizationNumber: '987654325',
    vatRegistered: true,
  });
  await customer.runFormulas();
  await customer.sync();

  const item = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: 'SAF-T konsulenttjeneste',
    itemType: 'Service',
    for: 'Sales',
    unit: 'Unit',
    rate: 1000,
    tax: 'Utgående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Varekostnad - 40000',
  });
  await item.sync();

  const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: 'SAF-T Testkunde AS',
    dueDate: `${year}-10-03`,
    deliveryDate: `${year}-09-19T12:00:00.000Z`,
    deliveryPlace: 'Oslo',
    date: new Date(`${year}-09-19T12:00:00.000Z`),
    items: [
      {
        item: 'SAF-T konsulenttjeneste',
        quantity: 1,
        rate: 1000,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;

  await invoice.runFormulas();
  await invoice.sync();
  await invoice.submit();

  const result = await buildNorwegianSaftFinancial140(fyo, {
    fromDate: `${year}-01-01`,
    toDate: `${year}-12-31`,
    createdDate: `${year}-09-19`,
    softwareVersion: '0.37.0-test',
  });

  t.equal(
    NORWEGIAN_SAF_T_VERSION,
    '1.40',
    'export targets SAF-T Financial 1.40'
  );
  t.equal(result.numberOfEntries, 1, 'one posted invoice becomes one transaction');
  t.equal(result.totalDebit, 1250, 'SAF-T total debit is NOK 1,250');
  t.equal(result.totalCredit, 1250, 'SAF-T total credit is NOK 1,250');

  t.ok(
    result.xml.includes(
      '<AuditFile xmlns="urn:StandardAuditFile-Taxation-Financial:NO">'
    ),
    'uses Norwegian SAF-T Financial namespace'
  );
  t.ok(
    result.xml.includes('<AuditFileVersion>1.40</AuditFileVersion>'),
    'writes SAF-T version 1.40'
  );
  t.ok(
    result.xml.includes('<AuditFileCountry>NO</AuditFileCountry>'),
    'writes Norway as audit-file country'
  );
  t.ok(
    result.xml.includes(
      '<RegistrationNumber>123456785</RegistrationNumber>'
    ),
    'writes company organization number'
  );
  t.ok(
    result.xml.includes('<Name>SAF-T Test &amp; Company AS</Name>'),
    'XML-escapes company name'
  );
  t.ok(
    result.xml.includes(
      `<SelectionStartDate>${year}-01-01</SelectionStartDate>`
    ),
    'writes selection start date'
  );
  t.ok(
    result.xml.includes(
      `<SelectionEndDate>${year}-12-31</SelectionEndDate>`
    ),
    'writes selection end date'
  );
  t.ok(
    result.xml.includes('<TaxAccountingBasis>A</TaxAccountingBasis>'),
    'writes accounting tax basis'
  );
  t.ok(
    result.xml.includes('<NumberOfEntries>1</NumberOfEntries>'),
    'writes transaction count'
  );
  t.ok(
    result.xml.includes('<TotalDebit>1250.00</TotalDebit>') &&
      result.xml.includes('<TotalCredit>1250.00</TotalCredit>'),
    'writes balanced general-ledger totals'
  );
  t.ok(
    result.xml.includes(`<TransactionID>${invoice.name}</TransactionID>`),
    'uses invoice number as transaction ID'
  );
  t.ok(
    result.xml.includes('<VoucherType>SI</VoucherType>'),
    'identifies sales-invoice voucher type'
  );
  t.ok(
    result.xml.includes('<AccountID>15000</AccountID>') &&
      result.xml.includes('<AccountID>30000</AccountID>') &&
      result.xml.includes('<AccountID>27000</AccountID>'),
    'exports Norwegian general-ledger account IDs'
  );
  t.ok(
    result.xml.includes('<DebitAmount>') &&
      result.xml.includes('<CreditAmount>'),
    'exports debit and credit amount structures'
  );

  t.equal(
    getSaftAccountId('Salgsinntekt, avgiftspliktig, 25 % - 30000'),
    '30000',
    'extracts numeric Norwegian account ID'
  );
  t.equal(
    getSaftAccountId('Test Bank'),
    'Test Bank',
    'preserves system account ID when no numeric suffix exists'
  );
});

test.onFinish(async () => {
  await fyo.close();
});
