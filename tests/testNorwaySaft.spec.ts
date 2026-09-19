import setupInstance from 'src/setup/setupInstance';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { PurchaseInvoice } from 'models/baseModels/PurchaseInvoice/PurchaseInvoice';
import { ModelNameEnum } from 'models/types';
import {
  buildNorwegianSaftFinancial140,
  getSaftAccountId,
  getSaftPartyId,
  getNorwegianSaftGrouping,
  NORWEGIAN_SME_SAFT_GROUPING_BY_ACCOUNT,
  NORWEGIAN_SAF_T_VERSION,
} from 'regional/noSaft';
import test from 'tape';
import { getTestDbPath, getTestFyo } from './helpers';
import norwayCoa from 'fixtures/verified/no.json';

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

  const euroCustomer = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: 'SAF-T Euro Testkunde AS',
    role: 'Customer',
    email: 'euro-saft@example.invalid',
    organizationNumber: '765432103',
    currency: 'EUR',
  });
  await euroCustomer.runFormulas();
  await euroCustomer.sync();

  const euroItem = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: 'SAF-T EUR konsulenttjeneste',
    itemType: 'Service',
    for: 'Sales',
    unit: 'Unit',
    rate: 100,
    tax: 'Utgående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Varekostnad - 40000',
  });
  await euroItem.sync();

  const euroInvoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: 'SAF-T Euro Testkunde AS',
    exchangeRate: 11.5,
    dueDate: `${year}-10-04`,
    deliveryDate: `${year}-09-21T12:00:00.000Z`,
    deliveryPlace: 'Oslo',
    date: new Date(`${year}-09-21T12:00:00.000Z`),
    items: [
      {
        item: 'SAF-T EUR konsulenttjeneste',
        quantity: 1,
        rate: 100,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;

  await euroInvoice.runFormulas();
  await euroInvoice.sync();
  await euroInvoice.submit();

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
  t.equal(result.numberOfEntries, 3, 'three posted invoices become three transactions');
  t.equal(result.totalDebit, 3937.5, 'SAF-T total debit is NOK 3,937.50');
  t.equal(result.totalCredit, 3937.5, 'SAF-T total credit is NOK 3,937.50');

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
    result.xml.includes('<NumberOfEntries>3</NumberOfEntries>'),
    'writes transaction count'
  );
  t.ok(
    result.xml.includes('<TotalDebit>3937.50</TotalDebit>') &&
      result.xml.includes('<TotalCredit>3937.50</TotalCredit>'),
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
    result.xml.includes('<GeneralLedgerAccounts>') &&
      result.xml.includes('<AccountID>15000</AccountID>') &&
      result.xml.includes('<AccountType>GL</AccountType>'),
    'exports SAF-T general-ledger account master data'
  );
  t.ok(
    result.xml.includes(
      '<AccountID>15000</AccountID>\n        <AccountDescription>Kundefordringer</AccountDescription>\n        <GroupingCategory>balanseverdiForOmloepsmiddel</GroupingCategory>\n        <GroupingCode>1500</GroupingCode>'
    ),
    'maps receivables to the Norwegian grouping codelist'
  );
  t.ok(
    result.xml.includes(
      '<AccountID>30000</AccountID>\n        <AccountDescription>Salgsinntekt, avgiftspliktig, 25 %</AccountDescription>\n        <GroupingCategory>salgsinntekt</GroupingCategory>\n        <GroupingCode>3000</GroupingCode>'
    ),
    'maps taxable sales revenue to the Norwegian grouping codelist'
  );
  t.ok(
    result.xml.includes(
      '<AccountID>27000</AccountID>\n        <AccountDescription>Utgående MVA, 25 %</AccountDescription>\n        <GroupingCategory>kortsiktigGjeld</GroupingCategory>\n        <GroupingCode>2740</GroupingCode>'
    ),
    'maps VAT control accounts to the Norwegian VAT grouping code'
  );
  t.ok(
    result.xml.includes(
      '<AccountID>15000</AccountID>\n        <AccountDescription>Kundefordringer</AccountDescription>\n        <GroupingCategory>balanseverdiForOmloepsmiddel</GroupingCategory>\n        <GroupingCode>1500</GroupingCode>\n        <AccountType>GL</AccountType>\n        <OpeningDebitBalance>0.00</OpeningDebitBalance>\n        <ClosingDebitBalance>2687.50</ClosingDebitBalance>'
    ),
    'exports real GL opening and closing balances'
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
    3,
    'emits VAT information only on taxable base lines'
  );

  const euroTransactionStart = result.xml.indexOf(
    `<TransactionID>${euroInvoice.name}</TransactionID>`
  );
  const euroTransactionEnd = result.xml.indexOf(
    '</Transaction>',
    euroTransactionStart
  );
  const euroTransactionXml = result.xml.slice(
    euroTransactionStart,
    euroTransactionEnd
  );

  t.ok(
    euroTransactionXml.includes('<Amount>1150.00</Amount>') &&
      euroTransactionXml.includes('<CurrencyCode>EUR</CurrencyCode>') &&
      euroTransactionXml.includes('<CurrencyAmount>100</CurrencyAmount>') &&
      euroTransactionXml.includes('<ExchangeRate>11.5</ExchangeRate>'),
    'exports foreign-currency ledger amount structure'
  );
  t.ok(
    euroTransactionXml.includes('<CreditTaxAmount>') &&
      euroTransactionXml.includes('<Amount>287.50</Amount>') &&
      euroTransactionXml.includes('<CurrencyAmount>25</CurrencyAmount>'),
    'exports foreign-currency VAT amount structure'
  );
  t.ok(
    euroTransactionXml.includes('<CreditNOKTaxAmount>') &&
      euroTransactionXml.includes('<NOKAmount>287.50</NOKAmount>') &&
      euroTransactionXml.includes('<NOKTaxBase>1150.00</NOKTaxBase>'),
    'locks foreign-currency VAT amount and tax base in NOK for SAF-T 1.40'
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

  t.deepEqual(
    getNorwegianSaftGrouping({
      name: 'Test Bank',
      accountType: 'Bank',
      rootType: 'Asset',
    }),
    {
      category: 'balanseverdiForOmloepsmiddel',
      code: '1920',
    },
    'derives bank grouping from account type'
  );

  const starterAccountNumbers: string[] = [];
  const collectAccountNumbers = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }

    const record = node as Record<string, unknown>;
    if (typeof record.accountNumber === 'string') {
      starterAccountNumbers.push(record.accountNumber);
    }

    for (const value of Object.values(record)) {
      collectAccountNumbers(value);
    }
  };
  collectAccountNumbers(norwayCoa.tree);

  t.equal(
    starterAccountNumbers.length,
    61,
    'Norwegian SME starter chart exposes 61 numbered accounts'
  );
  t.equal(
    starterAccountNumbers.filter(
      (accountNumber) =>
        !NORWEGIAN_SME_SAFT_GROUPING_BY_ACCOUNT[accountNumber]
    ).length,
    0,
    'starter chart has a SAF-T grouping for every numbered account'
  );

  t.deepEqual(
    getNorwegianSaftGrouping({
      name: 'Salgsinntekt, redusert sats - 31000',
      rootType: 'Income',
    }),
    { category: 'salgsinntekt', code: '3000' },
    'reduced-rate taxable sales map to taxable-sales grouping'
  );
  t.deepEqual(
    getNorwegianSaftGrouping({
      name: 'Salgsinntekt, fritatt for MVA - 32000',
      rootType: 'Income',
    }),
    { category: 'salgsinntekt', code: '3100' },
    'zero-rated sales map to zero-rate sales grouping'
  );
  t.deepEqual(
    getNorwegianSaftGrouping({
      name: 'Lån fra kredittinstitusjoner - 22400',
      rootType: 'Liability',
    }),
    { category: 'langsiktigGjeld', code: '2220' },
    'long-term credit-institution debt maps to official bank-debt grouping'
  );
  t.deepEqual(
    getNorwegianSaftGrouping({
      name: 'Kontorrekvisita - 68000',
      rootType: 'Expense',
    }),
    { category: 'annenDriftskostnad', code: '6995' },
    'office supplies map to official office and communications grouping'
  );
});

test.onFinish(async () => {
  await fyo.close();
});
