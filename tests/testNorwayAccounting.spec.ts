import setupInstance from 'src/setup/setupInstance';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { PurchaseInvoice } from 'models/baseModels/PurchaseInvoice/PurchaseInvoice';
import { Payment } from 'models/baseModels/Payment/Payment';
import { getNorwegianVatSummary } from 'reports/NorwegianVAT/NorwegianVAT';
import { ModelNameEnum } from 'models/types';
import test from 'tape';
import { getTestDbPath, getTestFyo } from './helpers';

const fyo = getTestFyo();
const dbPath = getTestDbPath();

test('Norwegian sales invoice posts 25 percent MVA correctly', async (t) => {
  const year = new Date().getFullYear();

  await setupInstance(
    dbPath,
    {
      logo: null,
      companyName: 'Norway Accounting Test AS',
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

  const customerName = 'Norsk Testkunde AS';
  const receivableAccount = 'Kundefordringer - 15000';
  const serviceName = 'Konsulenttjeneste';

  const customer = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: customerName,
    role: 'Customer',
    email: 'kunde@example.invalid',
    organizationNumber: '987654325',
  });
  await customer.runFormulas();
  await customer.sync();

  t.equal(
    customer.defaultAccount,
    receivableAccount,
    'customer defaults to Norwegian receivables account'
  );
  t.equal(
    customer.get('organizationNumber'),
    '987654325',
    'customer keeps Norwegian organization number'
  );

  const service = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: serviceName,
    itemType: 'Service',
    for: 'Sales',
    unit: 'Unit',
    rate: 10000,
    tax: 'Utgående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Varekostnad - 40000',
  });
  await service.sync();

  const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: receivableAccount,
    party: customerName,
    items: [
      {
        item: serviceName,
        quantity: 1,
        rate: 10000,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;

  await invoice.runFormulas();

  t.equal(invoice.netTotal?.float, 10000, 'net total is NOK 10,000');
  t.equal(invoice.grandTotal?.float, 12500, 'gross total is NOK 12,500');
  t.equal(invoice.taxes?.length, 1, 'invoice has one VAT summary row');
  t.equal(
    invoice.taxes?.[0]?.amount?.float,
    2500,
    'output VAT is NOK 2,500'
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
    12500,
    'receivables debited NOK 12,500'
  );
  t.equal(
    fyo.pesa(
      byAccount['Salgsinntekt, avgiftspliktig, 25 % - 30000']?.credit as string
    ).float,
    10000,
    'sales revenue credited NOK 10,000'
  );
  t.equal(
    fyo.pesa(byAccount['Utgående MVA, 25 % - 27000']?.credit as string).float,
    2500,
    'output VAT credited NOK 2,500'
  );
});

test('Norwegian purchase invoice posts 25 percent input MVA correctly', async (t) => {
  const supplierName = 'Norsk Testleverandør AS';
  const payableAccount = 'Leverandørgjeld - 24000';
  const purchaseItemName = 'Innkjøpt konsulenttjeneste';

  const supplier = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: supplierName,
    role: 'Supplier',
    email: 'leverandor@example.invalid',
  });
  await supplier.runFormulas();
  await supplier.sync();

  t.equal(
    supplier.defaultAccount,
    payableAccount,
    'supplier defaults to Norwegian payables account'
  );

  const purchaseItem = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: purchaseItemName,
    itemType: 'Service',
    for: 'Purchases',
    unit: 'Unit',
    rate: 10000,
    tax: 'Inngående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Fremmede tjenester - 67000',
  });
  await purchaseItem.sync();

  const invoice = fyo.doc.getNewDoc(ModelNameEnum.PurchaseInvoice, {
    account: payableAccount,
    party: supplierName,
    items: [
      {
        item: purchaseItemName,
        quantity: 1,
        rate: 10000,
        tax: 'Inngående MVA 25 %',
      },
    ],
  }) as PurchaseInvoice;

  await invoice.runFormulas();

  t.equal(invoice.netTotal?.float, 10000, 'purchase net total is NOK 10,000');
  t.equal(invoice.grandTotal?.float, 12500, 'purchase gross total is NOK 12,500');
  t.equal(invoice.taxes?.length, 1, 'purchase invoice has one VAT summary row');
  t.equal(
    invoice.taxes?.[0]?.amount?.float,
    2500,
    'input VAT is NOK 2,500'
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
    fyo.pesa(byAccount['Fremmede tjenester - 67000']?.debit as string).float,
    10000,
    'expense debited NOK 10,000'
  );
  t.equal(
    fyo.pesa(byAccount['Inngående MVA, 25 % - 27100']?.debit as string).float,
    2500,
    'input VAT debited NOK 2,500'
  );
  t.equal(
    fyo.pesa(byAccount[payableAccount]?.credit as string).float,
    12500,
    'payables credited NOK 12,500'
  );
});

test('Norwegian customer payment settles receivable through bank', async (t) => {
  const invoice = (await fyo.doc.getDoc(
    ModelNameEnum.SalesInvoice,
    'SINV-1001'
  )) as SalesInvoice;

  const payment = invoice.getPayment() as Payment;
  await payment.set({
    paymentMethod: 'Bank',
    paymentAccount: 'Test Bank',
    referenceId: 'BANK-SALE-001',
    clearanceDate: new Date(),
  });
  await payment.runFormulas();
  await payment.sync();
  await payment.submit();

  const entries = await fyo.db.getAllRaw(ModelNameEnum.AccountingLedgerEntry, {
    fields: ['account', 'debit', 'credit'],
    filters: { referenceName: payment.name! },
  });

  const byAccount = Object.fromEntries(
    entries.map((entry) => [entry.account as string, entry])
  );

  t.equal(
    fyo.pesa(byAccount['Test Bank']?.debit as string).float,
    12500,
    'bank debited NOK 12,500 on customer receipt'
  );
  t.equal(
    fyo.pesa(byAccount['Kundefordringer - 15000']?.credit as string).float,
    12500,
    'receivables credited NOK 12,500 on customer receipt'
  );

  await invoice.load();
  t.equal(invoice.outstandingAmount?.float, 0, 'sales invoice is fully settled');
});

test('Norwegian supplier payment settles payable through bank', async (t) => {
  const invoice = (await fyo.doc.getDoc(
    ModelNameEnum.PurchaseInvoice,
    'PINV-1001'
  )) as PurchaseInvoice;

  const payment = invoice.getPayment() as Payment;
  await payment.set({
    paymentMethod: 'Bank',
    account: 'Test Bank',
    referenceId: 'BANK-PURCHASE-001',
    clearanceDate: new Date(),
  });
  await payment.runFormulas();
  await payment.sync();
  await payment.submit();

  const entries = await fyo.db.getAllRaw(ModelNameEnum.AccountingLedgerEntry, {
    fields: ['account', 'debit', 'credit'],
    filters: { referenceName: payment.name! },
  });

  const byAccount = Object.fromEntries(
    entries.map((entry) => [entry.account as string, entry])
  );

  t.equal(
    fyo.pesa(byAccount['Leverandørgjeld - 24000']?.debit as string).float,
    12500,
    'payables debited NOK 12,500 on supplier payment'
  );
  t.equal(
    fyo.pesa(byAccount['Test Bank']?.credit as string).float,
    12500,
    'bank credited NOK 12,500 on supplier payment'
  );

  await invoice.load();
  t.equal(
    invoice.outstandingAmount?.float,
    0,
    'purchase invoice is fully settled'
  );
});

test('Norwegian reduced VAT rates calculate and post correctly', async (t) => {
  const customerName = 'Norsk Testkunde AS';
  const receivableAccount = 'Kundefordringer - 15000';

  const cases = [
    {
      itemName: 'Testtjeneste 15 prosent',
      tax: 'Utgående MVA 15 %',
      vatAccount: 'Utgående MVA, 15 % - 27010',
      rate: 15,
      expectedVat: 1500,
      expectedGross: 11500,
    },
    {
      itemName: 'Testtjeneste 12 prosent',
      tax: 'Utgående MVA 12 %',
      vatAccount: 'Utgående MVA, 12 % - 27020',
      rate: 12,
      expectedVat: 1200,
      expectedGross: 11200,
    },
  ];

  for (const vatCase of cases) {
    const item = fyo.doc.getNewDoc(ModelNameEnum.Item, {
      name: vatCase.itemName,
      itemType: 'Service',
      for: 'Sales',
      unit: 'Unit',
      rate: 10000,
      tax: vatCase.tax,
      incomeAccount: 'Salgsinntekt, redusert sats - 31000',
      expenseAccount: 'Varekostnad - 40000',
    });
    await item.sync();

    const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
      account: receivableAccount,
      party: customerName,
      items: [
        {
          item: vatCase.itemName,
          quantity: 1,
          rate: 10000,
          tax: vatCase.tax,
        },
      ],
    }) as SalesInvoice;

    await invoice.runFormulas();

    t.equal(
      invoice.taxes?.[0]?.amount?.float,
      vatCase.expectedVat,
      `${vatCase.rate}% VAT is calculated correctly`
    );
    t.equal(
      invoice.grandTotal?.float,
      vatCase.expectedGross,
      `${vatCase.rate}% gross total is calculated correctly`
    );

    await invoice.sync();
    await invoice.submit();

    const entries = await fyo.db.getAllRaw(ModelNameEnum.AccountingLedgerEntry, {
      fields: ['account', 'debit', 'credit'],
      filters: { referenceName: invoice.name! },
    });

    const vatEntry = entries.find(
      (entry) => entry.account === vatCase.vatAccount
    );

    t.equal(
      fyo.pesa(vatEntry?.credit as string).float,
      vatCase.expectedVat,
      `${vatCase.rate}% output VAT posts to the correct Norwegian account`
    );
  }
});

test('Norwegian sales credit note reverses revenue and output VAT', async (t) => {
  const original = (await fyo.doc.getDoc(
    ModelNameEnum.SalesInvoice,
    'SINV-1001'
  )) as SalesInvoice;

  const creditNote = (await original.getReturnDoc()) as SalesInvoice;
  await creditNote.runFormulas();

  t.equal(creditNote.netTotal?.float, -10000, 'credit note net total is -10,000');
  t.equal(
    creditNote.grandTotal?.float,
    -12500,
    'credit note gross total is -12,500'
  );
  t.equal(
    creditNote.taxes?.[0]?.amount?.float,
    -2500,
    'credit note reverses NOK 2,500 output VAT'
  );

  await creditNote.sync();
  await creditNote.submit();

  const entries = await fyo.db.getAllRaw(ModelNameEnum.AccountingLedgerEntry, {
    fields: ['account', 'debit', 'credit'],
    filters: { referenceName: creditNote.name! },
  });

  const byAccount = Object.fromEntries(
    entries.map((entry) => [entry.account as string, entry])
  );

  t.equal(
    fyo.pesa(
      byAccount['Salgsinntekt, avgiftspliktig, 25 % - 30000']?.debit as string
    ).float,
    10000,
    'credit note debits sales revenue NOK 10,000'
  );
  t.equal(
    fyo.pesa(byAccount['Utgående MVA, 25 % - 27000']?.debit as string).float,
    2500,
    'credit note debits output VAT NOK 2,500'
  );
  t.equal(
    fyo.pesa(byAccount['Kundefordringer - 15000']?.credit as string).float,
    12500,
    'credit note credits receivables NOK 12,500'
  );
});

test('Norwegian purchase credit note reverses expense and input VAT', async (t) => {
  const original = (await fyo.doc.getDoc(
    ModelNameEnum.PurchaseInvoice,
    'PINV-1001'
  )) as PurchaseInvoice;

  const creditNote = (await original.getReturnDoc()) as PurchaseInvoice;
  await creditNote.runFormulas();

  t.equal(
    creditNote.netTotal?.float,
    -10000,
    'purchase credit note net total is -10,000'
  );
  t.equal(
    creditNote.grandTotal?.float,
    -12500,
    'purchase credit note gross total is -12,500'
  );
  t.equal(
    creditNote.taxes?.[0]?.amount?.float,
    -2500,
    'purchase credit note reverses NOK 2,500 input VAT'
  );

  await creditNote.sync();
  await creditNote.submit();

  const entries = await fyo.db.getAllRaw(ModelNameEnum.AccountingLedgerEntry, {
    fields: ['account', 'debit', 'credit'],
    filters: { referenceName: creditNote.name! },
  });

  const byAccount = Object.fromEntries(
    entries.map((entry) => [entry.account as string, entry])
  );

  t.equal(
    fyo.pesa(byAccount['Leverandørgjeld - 24000']?.debit as string).float,
    12500,
    'purchase credit note debits payables NOK 12,500'
  );
  t.equal(
    fyo.pesa(byAccount['Fremmede tjenester - 67000']?.credit as string).float,
    10000,
    'purchase credit note credits expense NOK 10,000'
  );
  t.equal(
    fyo.pesa(byAccount['Inngående MVA, 25 % - 27100']?.credit as string).float,
    2500,
    'purchase credit note credits input VAT NOK 2,500'
  );
});

test('Norwegian zero-rated and outside-scope sales remain distinct', async (t) => {
  const cases = [
    {
      itemName: 'Nullsats testtjeneste',
      tax: 'MVA 0 % (fritatt)',
      expectedTaxCode: 'NO-ZERO-DOM',
      expectedStandardCode: '5',
    },
    {
      itemName: 'Unntatt testtjeneste',
      tax: 'Unntatt MVA',
      expectedTaxCode: 'NO-OUTSIDE',
      expectedStandardCode: '6',
    },
  ];

  for (const vatCase of cases) {
    const item = fyo.doc.getNewDoc(ModelNameEnum.Item, {
      name: vatCase.itemName,
      itemType: 'Service',
      for: 'Sales',
      unit: 'Unit',
      rate: 10000,
      tax: vatCase.tax,
      incomeAccount: 'Salgsinntekt, fritatt for MVA - 32000',
      expenseAccount: 'Varekostnad - 40000',
    });
    await item.sync();

    const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
      account: 'Kundefordringer - 15000',
      party: 'Norsk Testkunde AS',
      items: [
        {
          item: vatCase.itemName,
          quantity: 1,
          rate: 10000,
          tax: vatCase.tax,
        },
      ],
    }) as SalesInvoice;

    await invoice.runFormulas();

    t.equal(
      invoice.grandTotal?.float,
      10000,
      `${vatCase.tax} keeps gross equal to net`
    );
    t.equal(
      invoice.taxes?.length ?? 0,
      0,
      `${vatCase.tax} creates no monetary VAT summary row`
    );

    const taxTemplate = await fyo.doc.getDoc('Tax', vatCase.tax);
    t.equal(
      taxTemplate?.get('taxCode'),
      vatCase.expectedTaxCode,
      `${vatCase.tax} keeps its distinct internal tax code`
    );
    t.equal(
      taxTemplate?.get('standardTaxCode'),
      vatCase.expectedStandardCode,
      `${vatCase.tax} keeps its distinct SAF-T classification`
    );

    await invoice.sync();
    await invoice.submit();

    const entries = await fyo.db.getAllRaw(ModelNameEnum.AccountingLedgerEntry, {
      fields: ['account'],
      filters: { referenceName: invoice.name! },
    });

    const vatAccounts = entries.filter((entry) => {
      const account = entry.account as string;
      return (
        account.startsWith('Utgående MVA') ||
        account.startsWith('Inngående MVA') ||
        account.startsWith('Oppgjørskonto MVA')
      );
    });

    t.equal(
      vatAccounts.length,
      0,
      `${vatCase.tax} produces no VAT ledger amount`
    );
  }
});

test('Norwegian VAT summary aggregates by SAF-T classification', async (t) => {
  const year = new Date().getFullYear();
  const rows = await getNorwegianVatSummary(
    fyo,
    `${year}-01-01`,
    `${year}-12-31`
  );

  const byCode = Object.fromEntries(
    rows.map((row) => [row.standardTaxCode, row])
  );

  t.equal(byCode['3']?.basis, 0, '25% output VAT basis nets to zero after credit note');
  t.equal(byCode['3']?.vatAmount, 0, '25% output VAT nets to zero after credit note');
  t.equal(byCode['31']?.basis, 10000, '15% output VAT basis is NOK 10,000');
  t.equal(byCode['31']?.vatAmount, 1500, '15% output VAT amount is NOK 1,500');
  t.equal(byCode['33']?.basis, 10000, '12% output VAT basis is NOK 10,000');
  t.equal(byCode['33']?.vatAmount, 1200, '12% output VAT amount is NOK 1,200');
  t.equal(byCode['1']?.basis, 0, '25% input VAT basis nets to zero after credit note');
  t.equal(byCode['1']?.vatAmount, 0, '25% input VAT nets to zero after credit note');
  t.equal(byCode['5']?.basis, 10000, 'zero-rated basis remains reportable');
  t.equal(byCode['5']?.vatAmount, 0, 'zero-rated VAT amount is zero');
  t.equal(byCode['6']?.basis, 10000, 'outside-scope basis remains reportable');
  t.equal(byCode['6']?.vatAmount, 0, 'outside-scope VAT amount is zero');
});

test.onFinish(async () => {
  await fyo.close();
});
