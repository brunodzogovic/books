import { promises as fs } from 'fs';
import path from 'path';
import { parseCSV } from 'utils/csvParser';
import setupInstance from 'src/setup/setupInstance';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { ModelNameEnum } from 'models/types';
import { getCsvData, getCsvFileData } from 'reports/commonExporter';
import { getSpreadsheetData } from 'reports/spreadsheetExporter';
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
  t.ok(actionLabels.includes('XLSX'), 'VAT report exposes XLSX export');
  t.ok(actionLabels.includes('ODS'), 'VAT report exposes ODS export');
  t.ok(actionLabels.includes('JSON'), 'VAT report keeps JSON export');
  t.ok(
    actionLabels.includes('SAF-T Financial 1.40 XML'),
    'VAT report keeps SAF-T XML export'
  );

  const csv = getCsvData(report);
  const csvFile = getCsvFileData(report);
  t.equal(
    csvFile.charCodeAt(0),
    0xfeff,
    'saved CSV starts with a UTF-8 BOM for office-suite encoding detection'
  );
  t.ok(
    csvFile.includes('Utgående MVA 25 %'),
    'office-file CSV keeps Norwegian text after the BOM'
  );
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

  const xlsx = getSpreadsheetData(report, 'xlsx');
  const ods = getSpreadsheetData(report, 'ods');
  t.equal(xlsx[0], 0x50, 'XLSX begins with a ZIP signature');
  t.equal(xlsx[1], 0x4b, 'XLSX has the PK ZIP signature');
  t.equal(ods[0], 0x50, 'ODS begins with a ZIP signature');
  t.equal(ods[1], 0x4b, 'ODS has the PK ZIP signature');

  const xlsxText = new TextDecoder().decode(xlsx);
  const odsText = new TextDecoder().decode(ods);
  t.ok(
    xlsxText.includes('Utgående MVA 25 %') &&
      xlsxText.includes('<v>1234.5</v>') &&
      xlsxText.includes('<v>308.63</v>'),
    'XLSX stores Norwegian text and report values as spreadsheet cells'
  );
  t.ok(
    odsText.includes('Utgående MVA 25 %') &&
      odsText.includes('office:value="1234.5"') &&
      odsText.includes('office:value="308.63"'),
    'ODS stores Norwegian text and report values as spreadsheet cells'
  );

  const artifactDir = process.env.NORWAY_EXPORT_ARTIFACT_DIR;
  if (artifactDir) {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(path.join(artifactDir, 'norwegian-vat.xlsx'), xlsx);
    await fs.writeFile(path.join(artifactDir, 'norwegian-vat.ods'), ods);
    t.ok(true, 'office export fixtures written for external compatibility checks');
  }
});


test('Norwegian Bokmål VAT/export UI coverage', async (t) => {
  const csv = await fs.readFile(
    path.join(__dirname, '../translations/nb-NO.csv'),
    'utf8'
  );
  const languageMap = Object.fromEntries(
    parseCSV(csv).map(([source, translation]) => [source, translation])
  );

  const expected = {
    'Norwegian VAT Summary': 'Norsk MVA-sammendrag',
    'SAF-T VAT Code': 'SAF-T MVA-kode',
    'System VAT Code': 'Systemets MVA-kode',
    'Tax Template': 'MVA-mal',
    'VAT Basis': 'MVA-grunnlag',
    'VAT Amount': 'MVA-beløp',
    'From Date': 'Fra dato',
    'To Date': 'Til dato',
    Export: 'Eksport',
    'SAF-T Export Successful': 'SAF-T-eksport fullført',
    'Submitted Norwegian sales invoices cannot be cancelled. Issue a credit note instead.':
      'Innsendte norske salgsfakturaer kan ikke annulleres. Utsted en kreditnota i stedet.',
  } as Record<string, string>;

  for (const [source, translation] of Object.entries(expected)) {
    t.equal(
      languageMap[source],
      translation,
      `Bokmål translates "${source}"`
    );
  }
});

test.onFinish(async () => {
  await fyo.close();
});
