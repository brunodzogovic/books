import setupInstance from 'src/setup/setupInstance';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { PurchaseInvoice } from 'models/baseModels/PurchaseInvoice/PurchaseInvoice';
import { ModelNameEnum } from 'models/types';
import {
  buildNorwegianSaftFinancial140,
  getSaftAccountId,
  getSaftPartyId,
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

  const supplier = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: 'SAF-T Testleverandør AS',
    role: 'Supplier',
    email: 'leverandor@example.invalid',
    organizationNumber: '876543214',
  });
  await supplier.runFormulas();
  await supplier.sync();

  const purchaseItem = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: 'SAF-T innkjøpt tjeneste',
    itemType: 'Service',
    for: 'Purchases',
    unit: 'Unit',
    rate: 1000,
    tax: 'Inngående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Fremmede tjenester - 67000',
  });
  await purchaseItem.sync();

  const purchaseInvoice = fyo.doc.getNewDoc(ModelNameEnum.PurchaseInvoice, {
    account: 'Leverandørgjeld - 24000',
    party: 'SAF-T Testleverandør AS',
    date: new Date(`${year}-09-20T12:00:00.000Z`),
    items: [
      {
        item: 'SAF-T innkjøpt tjeneste',
        quantity: 1,
        rate: 1000,
        tax: 'Inngående MVA 25 %',
      },
    ],
  }) as PurchaseInvoice;

  await purchaseInvoice.runFormulas();
  await purchaseInvoice.sync();
  await purchaseInvoice.submit();

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
  t.equal(result.numberOfEntries, 2, 'two posted invoices become two transactions');
  t.equal(result.totalDebit, 2500, 'SAF-T total debit is NOK 2,500');
  t.equal(result.totalCredit, 2500, 'SAF-T total credit is NOK 2,500');

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
    result.xml.includes('<NumberOfEntries>2</NumberOfEntries>'),
    'writes transaction count'
  );
  t.ok(
    result.xml.includes('<TotalDebit>2500.00</TotalDebit>') &&
      result.xml.includes('<TotalCredit>2500.00</TotalCredit>'),
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

  t.ok(
    result.xml.includes('<MasterFiles>') &&
      result.xml.includes('<Customers>'),
    'exports SAF-T master files and customers'
  );
  t.ok(
    result.xml.includes('<CustomerID>987654325</CustomerID>') &&
      result.xml.includes('<Name>SAF-T Testkunde AS</Name>'),
    'exports customer master data'
  );
  t.ok(
    result.xml.includes('<Suppliers>') &&
      result.xml.includes('<SupplierID>876543214</SupplierID>') &&
      result.xml.includes('<Name>SAF-T Testleverandør AS</Name>'),
    'exports supplier master data'
  );
  t.ok(
    result.xml.includes(
      '<AccountID>15000</AccountID>\n          <OpeningDebitBalance>0.00</OpeningDebitBalance>\n          <ClosingDebitBalance>1250.00</ClosingDebitBalance>'
    ),
    'exports real customer opening and closing balances'
  );
  t.ok(
    result.xml.includes(
      '<AccountID>24000</AccountID>\n          <OpeningDebitBalance>0.00</OpeningDebitBalance>\n          <ClosingCreditBalance>1250.00</ClosingCreditBalance>'
    ),
    'exports real supplier opening and closing balances'
  );
  t.ok(
    result.xml.includes('<CustomerID>987654325</CustomerID>'),
    'tags receivable ledger line with customer ID'
  );
  t.ok(
    result.xml.includes('<SupplierID>876543214</SupplierID>'),
    'tags payable ledger line with supplier ID'
  );

  t.ok(
    result.xml.includes('<TaxTable>') &&
      result.xml.includes('<TaxType>MVA</TaxType>'),
    'exports Norwegian VAT tax table'
  );
  t.ok(
    result.xml.includes('<TaxCode>NO-OUT-25</TaxCode>') &&
      result.xml.includes('<StandardTaxCode>3</StandardTaxCode>') &&
      result.xml.includes('<TaxPercentage>25</TaxPercentage>'),
    'exports Norwegian VAT code mapping'
  );

  const salesTransactionStart = result.xml.indexOf(
    `<TransactionID>${invoice.name}</TransactionID>`
  );
  const salesTransactionEnd = result.xml.indexOf(
    '</Transaction>',
    salesTransactionStart
  );
  const salesTransactionXml = result.xml.slice(
    salesTransactionStart,
    salesTransactionEnd
  );

  t.ok(
    salesTransactionXml.includes(
      '<AccountID>30000</AccountID>'
    ) &&
      salesTransactionXml.includes('<TaxInformation>') &&
      salesTransactionXml.includes('<TaxCode>NO-OUT-25</TaxCode>') &&
      salesTransactionXml.includes('<TaxBase>1000.00</TaxBase>') &&
      salesTransactionXml.includes('<CreditTaxAmount>') &&
      salesTransactionXml.includes('<Amount>250.00</Amount>'),
    'attaches output VAT information to the sales revenue line'
  );

  const purchaseTransactionStart = result.xml.indexOf(
    `<TransactionID>${purchaseInvoice.name}</TransactionID>`
  );
  const purchaseTransactionEnd = result.xml.indexOf(
    '</Transaction>',
    purchaseTransactionStart
  );
  const purchaseTransactionXml = result.xml.slice(
    purchaseTransactionStart,
    purchaseTransactionEnd
  );

  t.ok(
    purchaseTransactionXml.includes(
      '<AccountID>67000</AccountID>'
    ) &&
      purchaseTransactionXml.includes('<TaxInformation>') &&
      purchaseTransactionXml.includes('<TaxCode>NO-IN-25</TaxCode>') &&
      purchaseTransactionXml.includes('<TaxBase>1000.00</TaxBase>') &&
      purchaseTransactionXml.includes('<DebitTaxAmount>') &&
      purchaseTransactionXml.includes('<Amount>250.00</Amount>'),
    'attaches input VAT information to the purchase expense line'
  );

  t.equal(
    (result.xml.match(/<TaxInformation>/g) ?? []).length,
    2,
    'emits VAT information only on taxable base lines'
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

  t.equal(
    getSaftPartyId({
      name: 'SAF-T Testkunde AS',
      role: 'Customer',
      organizationNumber: '987654325',
    }),
    '987654325',
    'uses organization number as stable SAF-T party ID'
  );
});

test.onFinish(async () => {
  await fyo.close();
});
