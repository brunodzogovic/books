import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { ModelNameEnum } from 'models/types';
import { buildNorwegianSaftFinancial140 } from 'regional/noSaft';
import { getNorwegianVatSummary } from 'reports/NorwegianVAT/NorwegianVAT';
import setupInstance from 'src/setup/setupInstance';
import test from 'tape';
import { getTestDbPath, getTestFyo } from './helpers';

const fyo = getTestFyo();
const dbPath = getTestDbPath();

test('Norwegian sales discounts reduce VAT basis and remain auditable', async (t) => {
  const year = new Date().getFullYear();

  await setupInstance(
    dbPath,
    {
      logo: null,
      companyName: 'Norway Discount Test AS',
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

  const discountAccount = fyo.doc.getNewDoc(ModelNameEnum.Account, {
    name: 'Sales discounts - 30898',
    parentAccount: 'Driftsinntekter',
    rootType: 'Income',
    accountType: 'Income Account',
  });
  await discountAccount.sync();
  await discountAccount.setAndSync('saftGrouping', 'salgsinntekt|3000');

  await fyo.singles.AccountingSettings?.setAndSync({
    enableDiscounting: true,
    discountAccount: discountAccount.name,
  });

  const customer = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: 'Discount Test Customer AS',
    role: 'Customer',
    organizationNumber: '987654325',
    vatRegistered: true,
  });
  await customer.runFormulas();
  await customer.sync();

  const item = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: 'Discounted consulting',
    itemType: 'Service',
    for: 'Sales',
    unit: 'Unit',
    rate: 10000,
    tax: 'Utgående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Varekostnad - 40000',
  });
  await item.sync();

  const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: customer.name,
    date: new Date(`${year}-06-10T12:00:00.000Z`),
    dueDate: `${year}-06-24`,
    deliveryDate: new Date(`${year}-06-10T12:00:00.000Z`),
    deliveryPlace: 'Oslo',
    items: [
      {
        item: item.name,
        quantity: 1,
        rate: 10000,
        tax: 'Utgående MVA 25 %',
        itemDiscountPercent: 10,
      },
    ],
  }) as SalesInvoice;

  await invoice.runFormulas();

  t.equal(invoice.netTotal?.float, 10000, 'gross line amount remains NOK 10,000');
  t.equal(
    invoice.getTotalDiscount().float,
    1000,
    '10 percent commercial discount is NOK 1,000'
  );
  t.equal(
    invoice.taxes?.[0]?.amount?.float,
    2250,
    'output VAT is calculated on the discounted NOK 9,000 basis'
  );
  t.equal(
    invoice.grandTotal?.float,
    11250,
    'invoice total is NOK 11,250 after discount and VAT'
  );

  await invoice.sync();
  await invoice.submit();

  const entries = await fyo.db.getAllRaw(ModelNameEnum.AccountingLedgerEntry, {
    fields: ['account', 'debit', 'credit'],
    filters: { referenceName: invoice.name! },
  });
  const byAccount = Object.fromEntries(
    entries.map((entry) => [entry.account as string, entry])
  );

  t.equal(
    fyo.pesa(byAccount['Kundefordringer - 15000']?.debit as string).float,
    11250,
    'receivables post the discounted gross amount'
  );
  t.equal(
    fyo.pesa(byAccount['Salgsinntekt, avgiftspliktig, 25 % - 30000']?.credit as string).float,
    10000,
    'sales revenue keeps the original line amount'
  );
  t.equal(
    fyo.pesa(byAccount[discountAccount.name!]?.debit as string).float,
    1000,
    'discount posts as a separate debit to the configured discount account'
  );
  t.equal(
    fyo.pesa(byAccount['Utgående MVA, 25 % - 27000']?.credit as string).float,
    2250,
    'output VAT ledger amount follows the discounted basis'
  );

  const vatRows = await getNorwegianVatSummary(
    fyo,
    `${year}-01-01`,
    `${year}-12-31`
  );
  const output25 = vatRows.find(({ standardTaxCode }) => standardTaxCode === '3');
  t.equal(output25?.basis, 9000, 'VAT summary reports discounted taxable basis');
  t.equal(output25?.vatAmount, 2250, 'VAT summary reports discounted output VAT');

  const saft = await buildNorwegianSaftFinancial140(fyo, {
    fromDate: `${year}-01-01`,
    toDate: `${year}-12-31`,
    createdDate: `${year}-12-31`,
    softwareVersion: '0.37.0-test',
  });

  const transactionStart = saft.xml.indexOf(
    `<TransactionID>${invoice.name}</TransactionID>`
  );
  const transactionEnd = saft.xml.indexOf('</Transaction>', transactionStart);
  const transactionXml = saft.xml.slice(transactionStart, transactionEnd);

  t.ok(
    transactionXml.includes('<TaxBase>9000.00</TaxBase>') &&
      transactionXml.includes('<Amount>2250.00</Amount>'),
    'SAF-T preserves discounted VAT basis and amount'
  );
  t.ok(
    saft.xml.includes('<AccountID>30898</AccountID>') &&
      saft.xml.includes('<GroupingCode>3000</GroupingCode>'),
    'configured discount account is mapped in SAF-T master data'
  );
});

test.onFinish(async () => {
  await fyo.close();
});
