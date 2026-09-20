import setupInstance from 'src/setup/setupInstance';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { ModelNameEnum } from 'models/types';
import { getCsvData } from 'reports/commonExporter';
import { NorwegianVAT } from 'reports/NorwegianVAT/NorwegianVAT';
import test from 'tape';
import { getTestDbPath, getTestFyo } from './helpers';

const fyo = getTestFyo();
const dbPath = getTestDbPath();

test('Norwegian VAT report exposes office-friendly exports', async (t) => {
  const year = new Date().getFullYear();

  await setupInstance(
    dbPath,
    {
      logo: null,
      companyName: 'Norway Export Test AS',
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

  const customer = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: 'Økonomi Testkunde AS',
    role: 'Customer',
    organizationNumber: '987654325',
    vatRegistered: true,
  });
  await customer.runFormulas();
  await customer.sync();

  const item = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: 'Rådgivning',
    itemType: 'Service',
    for: 'Sales',
    unit: 'Unit',
    rate: 1234.5,
    tax: 'Utgående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Varekostnad - 40000',
  });
  await item.sync();

  const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: customer.name,
    date: new Date(`${year}-05-15T12:00:00.000Z`),
    dueDate: `${year}-05-29`,
    deliveryDate: new Date(`${year}-05-15T12:00:00.000Z`),
    deliveryPlace: 'Tønsberg',
    items: [
      {
        item: item.name,
        quantity: 1,
        rate: 1234.5,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;

  await invoice.runFormulas();
  await invoice.sync();
  await invoice.submit();

  const report = new NorwegianVAT(fyo);
  report.fromDate = `${year}-01-01`;
  report.toDate = `${year}-12-31`;
  await report.initialize();

  const actionLabels = report.getActions().map(({ label }) => label);
  t.ok(actionLabels.includes('CSV'), 'VAT report exposes CSV export');
  t.ok(actionLabels.includes('JSON'), 'VAT report keeps JSON export');
  t.ok(
    actionLabels.includes('SAF-T Financial 1.40 XML'),
    'VAT report keeps SAF-T XML export'
  );

  const csv = getCsvData(report);
  t.ok(
    csv.includes('Utgående MVA 25 %'),
    'CSV preserves Norwegian non-ASCII VAT template text'
  );
  t.ok(
    csv.includes('1234.5'),
    'CSV preserves the taxable basis as a numeric value'
  );
  t.ok(
    csv.includes('308.63'),
    'CSV preserves the VAT amount with configured display precision'
  );
});

test.onFinish(async () => {
  await fyo.close();
});
