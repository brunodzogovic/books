import setupInstance from 'src/setup/setupInstance';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { PurchaseInvoice } from 'models/baseModels/PurchaseInvoice/PurchaseInvoice';
import { Payment } from 'models/baseModels/Payment/Payment';
import { getNorwegianVatSummary } from 'reports/NorwegianVAT/NorwegianVAT';
import { getNorwegianInvoiceCurrencyDisclosure } from 'regional/noInvoice';
import { ProfitAndLoss } from 'reports/ProfitAndLoss/ProfitAndLoss';
import { BalanceSheet } from 'reports/BalanceSheet/BalanceSheet';
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
    vatRegistered: true,
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
  t.equal(
    customer.get('vatRegistered'),
    true,
    'customer keeps Norwegian VAT registration status'
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
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    deliveryDate: new Date().toISOString(),
    deliveryPlace: 'Oslo',
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

  const vatSnapshot = JSON.parse(
    String(invoice.items?.[0]?.get('norwegianVatSnapshot') ?? '{}')
  ) as {
    taxCode?: string;
    standardTaxCode?: string;
    details?: { account?: string; rate?: number }[];
  };
  t.equal(
    vatSnapshot.taxCode,
    'NO-OUT-25',
    'submitted sales invoice snapshots Norwegian VAT code'
  );
  t.equal(
    vatSnapshot.standardTaxCode,
    '3',
    'submitted sales invoice snapshots SAF-T VAT classification'
  );
  t.equal(
    vatSnapshot.details?.[0]?.rate,
    25,
    'submitted sales invoice snapshots VAT rate'
  );
  t.equal(
    vatSnapshot.details?.[0]?.account,
    'Utgående MVA, 25 % - 27000',
    'submitted sales invoice snapshots VAT account'
  );

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
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      deliveryDate: new Date().toISOString(),
      deliveryPlace: 'Oslo',
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
  t.equal(
    creditNote.returnAgainst,
    original.name,
    'sales credit note references original invoice'
  );

  await creditNote.sync();

  let missingCorrectionReasonBlocked = false;
  try {
    await creditNote.submit();
  } catch (error) {
    missingCorrectionReasonBlocked = true;
    t.match(
      (error as Error).message,
      /Correction reason is required/,
      'sales credit note without correction reason is rejected'
    );
  }
  t.equal(
    missingCorrectionReasonBlocked,
    true,
    'sales credit note requires correction reason'
  );

  const correctionReason = 'Original invoice contained the wrong quantity';
  await creditNote.set('correctionReason', correctionReason);
  await creditNote.sync();
  await creditNote.submit();

  t.equal(
    creditNote.get('correctionReason'),
    correctionReason,
    'sales credit note stores correction reason'
  );

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

  const correctionReason = 'Supplier corrected the invoiced amount';
  await creditNote.set('correctionReason', correctionReason);
  await creditNote.sync();
  await creditNote.submit();

  t.equal(
    creditNote.get('correctionReason'),
    correctionReason,
    'purchase credit note stores correction reason'
  );

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

test('Norwegian credit-note refunds settle through bank', async (t) => {
  const salesCreditRows = await fyo.db.getAll(ModelNameEnum.SalesInvoice, {
    fields: ['name'],
    filters: {
      returnAgainst: 'SINV-1001',
      submitted: true,
      cancelled: false,
    },
  });
  const salesCredit = (await fyo.doc.getDoc(
    ModelNameEnum.SalesInvoice,
    salesCreditRows[0].name as string
  )) as SalesInvoice;

  t.equal(
    salesCredit.outstandingAmount?.float,
    12500,
    'paid sales invoice credit note exposes NOK 12,500 refund amount'
  );

  const customerRefund = salesCredit.getPayment() as Payment;
  t.equal(customerRefund.paymentType, 'Pay', 'customer refund is a Pay payment');
  t.equal(
    customerRefund.amount?.float,
    12500,
    'customer refund payment amount is positive NOK 12,500'
  );
  t.equal(
    customerRefund.for?.[0]?.amount?.float,
    12500,
    'customer refund reference amount is positive'
  );

  await customerRefund.set({
    paymentMethod: 'Bank',
    account: 'Test Bank',
    referenceId: 'BANK-REFUND-SALE-001',
    clearanceDate: new Date(),
  });
  await customerRefund.runFormulas();
  await customerRefund.sync();
  await customerRefund.submit();

  const customerRefundEntries = await fyo.db.getAllRaw(
    ModelNameEnum.AccountingLedgerEntry,
    {
      fields: ['account', 'debit', 'credit'],
      filters: { referenceName: customerRefund.name! },
    }
  );
  const customerRefundByAccount = Object.fromEntries(
    customerRefundEntries.map((entry) => [entry.account as string, entry])
  );

  t.equal(
    fyo.pesa(
      customerRefundByAccount['Kundefordringer - 15000']?.debit as string
    ).float,
    12500,
    'customer refund debits receivables NOK 12,500'
  );
  t.equal(
    fyo.pesa(customerRefundByAccount['Test Bank']?.credit as string).float,
    12500,
    'customer refund credits bank NOK 12,500'
  );

  await salesCredit.load();
  t.equal(
    salesCredit.outstandingAmount?.float,
    0,
    'sales credit note is fully refunded'
  );

  const purchaseCreditRows = await fyo.db.getAll(
    ModelNameEnum.PurchaseInvoice,
    {
      fields: ['name'],
      filters: {
        returnAgainst: 'PINV-1001',
        submitted: true,
        cancelled: false,
      },
    }
  );
  const purchaseCredit = (await fyo.doc.getDoc(
    ModelNameEnum.PurchaseInvoice,
    purchaseCreditRows[0].name as string
  )) as PurchaseInvoice;

  t.equal(
    purchaseCredit.outstandingAmount?.float,
    12500,
    'paid purchase invoice credit note exposes NOK 12,500 supplier refund amount'
  );

  const supplierRefund = purchaseCredit.getPayment() as Payment;
  t.equal(
    supplierRefund.paymentType,
    'Receive',
    'supplier refund is a Receive payment'
  );
  t.equal(
    supplierRefund.amount?.float,
    12500,
    'supplier refund payment amount is positive NOK 12,500'
  );
  t.equal(
    supplierRefund.for?.[0]?.amount?.float,
    12500,
    'supplier refund reference amount is positive'
  );

  await supplierRefund.set({
    paymentMethod: 'Bank',
    paymentAccount: 'Test Bank',
    referenceId: 'BANK-REFUND-PURCHASE-001',
    clearanceDate: new Date(),
  });
  await supplierRefund.runFormulas();
  await supplierRefund.sync();
  await supplierRefund.submit();

  const supplierRefundEntries = await fyo.db.getAllRaw(
    ModelNameEnum.AccountingLedgerEntry,
    {
      fields: ['account', 'debit', 'credit'],
      filters: { referenceName: supplierRefund.name! },
    }
  );
  const supplierRefundByAccount = Object.fromEntries(
    supplierRefundEntries.map((entry) => [entry.account as string, entry])
  );

  t.equal(
    fyo.pesa(supplierRefundByAccount['Test Bank']?.debit as string).float,
    12500,
    'supplier refund debits bank NOK 12,500'
  );
  t.equal(
    fyo.pesa(
      supplierRefundByAccount['Leverandørgjeld - 24000']?.credit as string
    ).float,
    12500,
    'supplier refund credits payables NOK 12,500'
  );

  await purchaseCredit.load();
  t.equal(
    purchaseCredit.outstandingAmount?.float,
    0,
    'purchase credit note is fully refunded'
  );
});

test('Norwegian zero-rated and outside-scope sales remain distinct', async (t) => {
  const cases = [
    {
      itemName: 'Nullsats testtjeneste',
      tax: 'MVA 0 % (fritatt)',
      expectedTaxCode: 'NO-ZERO-DOM',
      expectedStandardCode: '5',
      incomeAccount: 'Salgsinntekt, fritatt for MVA - 32000',
    },
    {
      itemName: 'Unntatt testtjeneste',
      tax: 'Unntatt MVA',
      expectedTaxCode: 'NO-OUTSIDE',
      expectedStandardCode: '6',
      incomeAccount: 'Salgsinntekt, unntatt MVA - 32500',
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
      incomeAccount: vatCase.incomeAccount,
      expenseAccount: 'Varekostnad - 40000',
    });
    await item.sync();

    const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
      account: 'Kundefordringer - 15000',
      party: 'Norsk Testkunde AS',
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    deliveryDate: new Date().toISOString(),
    deliveryPlace: 'Oslo',
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
    t.ok(
      entries.some((entry) => entry.account === vatCase.incomeAccount),
      `${vatCase.tax} posts to its dedicated revenue account`
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

test('Norwegian VAT reporting preserves submitted classification', async (t) => {
  const year = new Date().getFullYear();
  const tax = await fyo.doc.getDoc('Tax', 'Utgående MVA 15 %');

  const originalTaxCode = tax.get('taxCode') as string;
  const originalStandardTaxCode = tax.get('standardTaxCode') as string;

  await tax.set({
    taxCode: 'NO-CHANGED-AFTER-POSTING',
    standardTaxCode: '32',
  });
  await tax.sync();

  const rows = await getNorwegianVatSummary(
    fyo,
    `${year}-01-01`,
    `${year}-12-31`
  );
  const originalClassification = rows.find(
    ({ standardTaxCode }) => standardTaxCode === '31'
  );
  const rewrittenClassification = rows.find(
    ({ standardTaxCode, taxCode }) =>
      standardTaxCode === '32' &&
      taxCode === 'NO-CHANGED-AFTER-POSTING'
  );

  t.equal(
    originalClassification?.basis,
    10000,
    'submitted 15% VAT basis keeps SAF-T code 31 after template edit'
  );
  t.equal(
    originalClassification?.vatAmount,
    1500,
    'submitted 15% VAT amount keeps historical classification'
  );
  t.equal(
    rewrittenClassification,
    undefined,
    'editing a tax template does not rewrite posted VAT history'
  );

  await tax.set({
    taxCode: originalTaxCode,
    standardTaxCode: originalStandardTaxCode,
  });
  await tax.sync();
});

test('Norwegian invoice blocks unmapped VAT templates', async (t) => {
  const tax = fyo.doc.getNewDoc('Tax', {
    name: 'Uklassifisert norsk MVA',
    taxCode: 'NO-TEMP-25',
    standardTaxCode: '3',
    details: [
      {
        account: 'Utgående MVA, 25 % - 27000',
        rate: 25,
      },
    ],
  });
  await tax.sync();

  /*
   * Simulate an older/migrated database row that predates mandatory VAT
   * classification. Database migration permits empty defaults specifically so
   * existing books can open before the mapping is repaired.
   */
  await fyo.db.update('Tax', {
    name: 'Uklassifisert norsk MVA',
    taxCode: '',
    standardTaxCode: '',
  });

  /*
   * The Tax document created above is cached. Drop it so the invoice validation
   * reloads the persisted legacy row instead of seeing the pre-migration values.
   */
  fyo.doc.removeFromCache('Tax', 'Uklassifisert norsk MVA');

  const legacyTax = await fyo.db.get(
    'Tax',
    'Uklassifisert norsk MVA',
    ['taxCode', 'standardTaxCode']
  );
  t.equal(
    legacyTax.taxCode,
    '',
    'legacy VAT fixture has no internal tax code'
  );
  t.equal(
    legacyTax.standardTaxCode,
    '',
    'legacy VAT fixture has no SAF-T VAT classification'
  );

  const item = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: 'Uklassifisert MVA-test',
    itemType: 'Service',
    for: 'Sales',
    unit: 'Unit',
    rate: 1000,
    tax: 'Uklassifisert norsk MVA',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Varekostnad - 40000',
  });
  await item.sync();

  const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: 'Norsk Testkunde AS',
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    deliveryDate: new Date().toISOString(),
    deliveryPlace: 'Oslo',
    items: [
      {
        item: 'Uklassifisert MVA-test',
        quantity: 1,
        rate: 1000,
        tax: 'Uklassifisert norsk MVA',
      },
    ],
  }) as SalesInvoice;

  await invoice.runFormulas();
  await invoice.sync();

  let blocked = false;
  try {
    await invoice.submit();
  } catch (error) {
    blocked = true;
    t.match(
      (error as Error).message,
      /Norwegian VAT mapping is required/,
      'unmapped Norwegian VAT template is rejected'
    );
  }

  t.equal(blocked, true, 'unmapped VAT invoice cannot be submitted');
});

test('Norwegian foreign-currency invoice states VAT in NOK', async (t) => {
  const customerName = 'Euro Testkunde AS';
  const customer = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: customerName,
    role: 'Customer',
    email: 'euro@example.invalid',
    organizationNumber: '987654325',
    currency: 'EUR',
  });
  await customer.runFormulas();
  await customer.sync();

  const itemName = 'EUR konsulenttjeneste';
  const item = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: itemName,
    itemType: 'Service',
    for: 'Sales',
    unit: 'Unit',
    rate: 100,
    tax: 'Utgående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Varekostnad - 40000',
  });
  await item.sync();

  const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: customerName,
    exchangeRate: 11.5,
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    deliveryDate: new Date().toISOString(),
    deliveryPlace: 'Oslo',
    items: [
      {
        item: itemName,
        quantity: 1,
        rate: 100,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;

  await invoice.runFormulas();

  t.equal(invoice.currency, 'EUR', 'invoice uses customer currency EUR');
  t.equal(invoice.exchangeRate, 11.5, 'invoice locks supplied EUR/NOK exchange rate');
  t.equal(invoice.netTotal?.float, 100, 'foreign-currency net total is EUR 100');
  t.equal(invoice.taxes?.[0]?.amount?.float, 25, 'foreign-currency VAT is EUR 25');
  t.equal(invoice.grandTotal?.float, 125, 'foreign-currency gross total is EUR 125');
  t.equal(invoice.baseGrandTotal?.float, 1437.5, 'base grand total is NOK 1,437.50');

  const disclosure = await getNorwegianInvoiceCurrencyDisclosure(invoice);
  t.equal(
    disclosure.companyCurrency,
    'NOK',
    'currency disclosure identifies NOK as company currency'
  );
  t.equal(
    disclosure.showTaxInCompanyCurrency,
    true,
    'currency disclosure requires VAT in company currency'
  );
  t.equal(
    disclosure.taxTotalCompanyCurrency.float,
    287.5,
    'currency disclosure exposes NOK 287.50 VAT'
  );
  t.equal(
    disclosure.netTotalCompanyCurrency.float,
    1150,
    'currency disclosure exposes NOK 1,150.00 taxable basis'
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
    1437.5,
    'receivable posts in NOK'
  );
  t.equal(
    fyo.pesa(
      byAccount['Salgsinntekt, avgiftspliktig, 25 % - 30000']?.credit as string
    ).float,
    1150,
    'revenue posts in NOK'
  );
  t.equal(
    fyo.pesa(byAccount['Utgående MVA, 25 % - 27000']?.credit as string).float,
    287.5,
    'output VAT posts in NOK'
  );

  const year = new Date().getFullYear();
  const vatRows = await getNorwegianVatSummary(
    fyo,
    `${year}-01-01`,
    `${year}-12-31`
  );
  const standardCode3 = vatRows.find(({ standardTaxCode }) => standardTaxCode === '3');

  t.equal(
    standardCode3?.basis,
    1150,
    'VAT summary converts foreign taxable basis to NOK'
  );
  t.equal(
    standardCode3?.vatAmount,
    287.5,
    'VAT summary converts foreign VAT to NOK'
  );
});

test('Norwegian sales invoice blocks missing compliance fields', async (t) => {
  const customer = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: 'Kunde uten identifikasjon',
    role: 'Customer',
    email: 'ingenid@example.invalid',
  });
  await customer.runFormulas();
  await customer.sync();

  const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: 'Kunde uten identifikasjon',
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    deliveryDate: new Date().toISOString(),
    deliveryPlace: 'Oslo',
    items: [
      {
        item: 'Konsulenttjeneste',
        quantity: 1,
        rate: 1000,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;

  await invoice.runFormulas();
  await invoice.sync();

  let threw = false;
  try {
    await invoice.submit();
  } catch (error) {
    threw = true;
    t.match(
      (error as Error).message,
      /address or organization number/,
      'missing customer identification is rejected'
    );
  }

  t.equal(threw, true, 'non-compliant Norwegian sales invoice is blocked');
});

test('Norwegian accounting period lock blocks old postings and reversals', async (t) => {
  const year = new Date().getFullYear();
  await fyo.singles.AccountingSettings?.setAndSync(
    'accountingLockDate',
    new Date(`${year}-01-31T00:00:00.000Z`)
  );

  const lockedInvoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: 'Norsk Testkunde AS',
    date: new Date(`${year}-01-15T12:00:00.000Z`),
    dueDate: new Date(`${year}-02-15T00:00:00.000Z`),
    deliveryDate: new Date(`${year}-01-15T12:00:00.000Z`),
    deliveryPlace: 'Oslo',
    items: [
      {
        item: 'Konsulenttjeneste',
        quantity: 1,
        rate: 1000,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;

  await lockedInvoice.runFormulas();
  await lockedInvoice.sync();

  let oldPostingBlocked = false;
  try {
    await lockedInvoice.submit();
  } catch (error) {
    oldPostingBlocked = true;
    t.match(
      (error as Error).message,
      /locked through/,
      'posting inside locked period is rejected'
    );
  }
  t.equal(oldPostingBlocked, true, 'locked-period invoice cannot be submitted');

  const openInvoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: 'Norsk Testkunde AS',
    date: new Date(`${year}-02-01T12:00:00.000Z`),
    dueDate: new Date(`${year}-02-15T00:00:00.000Z`),
    deliveryDate: new Date(`${year}-02-01T12:00:00.000Z`),
    deliveryPlace: 'Oslo',
    items: [
      {
        item: 'Konsulenttjeneste',
        quantity: 1,
        rate: 1000,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;

  await openInvoice.runFormulas();
  await openInvoice.sync();
  await openInvoice.submit();
  t.equal(openInvoice.isSubmitted, true, 'posting after lock date is allowed');

  await fyo.singles.AccountingSettings?.setAndSync(
    'accountingLockDate',
    new Date(`${year}-02-28T00:00:00.000Z`)
  );

  let reversalBlocked = false;
  try {
    await openInvoice.cancel('Period close correction test');
  } catch (error) {
    reversalBlocked = true;
    t.match(
      (error as Error).message,
      /locked through/,
      'reversal inside locked period is rejected'
    );
  }
  t.equal(reversalBlocked, true, 'locked-period invoice cannot be cancelled');
});

test('Norwegian financial statements reconcile current-year activity', async (t) => {
  const year = new Date().getFullYear();

  const profitAndLoss = new ProfitAndLoss(fyo);
  profitAndLoss.basedOn = 'Until Date';
  profitAndLoss.toDate = `${year}-12-31`;
  profitAndLoss.count = 12;
  profitAndLoss.periodicity = 'Monthly';
  profitAndLoss.consolidateColumns = true;
  await profitAndLoss.initialize();

  const getTotal = (rows: typeof profitAndLoss.reportData, label: string) => {
    const row = rows.find(({ cells }) => cells[0]?.rawValue === label);
    return row?.cells[1]?.rawValue as number | undefined;
  };

  const totalIncome = getTotal(
    profitAndLoss.reportData,
    'Total Income (Credit)'
  );
  const totalExpense =
    getTotal(profitAndLoss.reportData, 'Total Expense (Debit)') ?? 0;

  t.equal(
    totalIncome,
    42150,
    'profit and loss reports NOK 42,150 current-year income'
  );
  t.equal(
    totalExpense,
    0,
    'fully reversed purchase activity leaves no current-year expense'
  );

  const totalProfit =
    getTotal(profitAndLoss.reportData, 'Total Profit') ??
    (totalIncome ?? 0) - totalExpense;

  t.equal(totalProfit, 42150, 'current-year profit is NOK 42,150');

  const balanceSheet = new BalanceSheet(fyo);
  balanceSheet.basedOn = 'Until Date';
  balanceSheet.toDate = `${year}-12-31`;
  balanceSheet.count = 12;
  balanceSheet.periodicity = 'Monthly';
  balanceSheet.consolidateColumns = true;
  await balanceSheet.initialize();

  const totalAssets =
    getTotal(balanceSheet.reportData, 'Total Asset (Debit)') ?? 0;
  const totalLiabilities =
    getTotal(balanceSheet.reportData, 'Total Liability (Credit)') ?? 0;
  const totalEquity =
    getTotal(balanceSheet.reportData, 'Total Equity (Credit)') ?? 0;

  t.equal(totalAssets, 45387.5, 'balance sheet assets are NOK 45,387.50');
  t.equal(
    totalLiabilities,
    3237.5,
    'balance sheet liabilities reflect post-refund VAT position'
  );

  t.equal(
    totalAssets,
    totalLiabilities + totalEquity + totalProfit,
    'assets reconcile to liabilities, equity, and current-year profit'
  );
});

test('Norwegian cancelled postings remain immutable and auditable', async (t) => {
  await fyo.singles.AccountingSettings?.setAndSync(
    'accountingLockDate',
    new Date('2026-02-28T00:00:00.000Z')
  );

  const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: 'Norsk Testkunde AS',
    date: new Date('2026-09-19T12:00:00.000Z'),
    dueDate: new Date('2026-10-03T00:00:00.000Z'),
    deliveryDate: new Date('2026-09-19T12:00:00.000Z'),
    deliveryPlace: 'Oslo',
    items: [
      {
        item: 'Konsulenttjeneste',
        quantity: 1,
        rate: 2000,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;

  await invoice.runFormulas();
  await invoice.sync();
  await invoice.submit();

  t.equal(invoice.canEdit, false, 'submitted Norwegian posting cannot be edited');

  const originalEntries = await fyo.db.getAllRaw(
    ModelNameEnum.AccountingLedgerEntry,
    {
      fields: ['name', 'account', 'debit', 'credit', 'reverted', 'reverts'],
      filters: { referenceName: invoice.name! },
    }
  );

  t.equal(originalEntries.length, 3, 'submitted invoice creates three ledger entries');

  let missingReasonBlocked = false;
  try {
    await invoice.cancel();
  } catch (error) {
    missingReasonBlocked = true;
    t.match(
      (error as Error).message,
      /Cancellation reason is required/,
      'cancellation without a reason is rejected'
    );
  }
  t.equal(
    missingReasonBlocked,
    true,
    'Norwegian cancellation requires an audit reason'
  );

  const cancellationReason = 'Customer order was entered twice';
  await invoice.cancel(cancellationReason);

  t.equal(invoice.isCancelled, true, 'invoice is marked cancelled');
  t.equal(
    invoice.get('cancellationReason'),
    cancellationReason,
    'cancellation reason is stored on the cancelled document'
  );
  t.equal(
    invoice.canDelete,
    false,
    'cancelled Norwegian posting cannot be deleted'
  );

  const reversedEntries = await fyo.db.getAllRaw(
    ModelNameEnum.AccountingLedgerEntry,
    {
      fields: ['name', 'account', 'debit', 'credit', 'reverted', 'reverts'],
      filters: { referenceName: invoice.name! },
    }
  );

  t.equal(
    reversedEntries.length,
    6,
    'cancellation preserves originals and adds three reversing entries'
  );
  t.equal(
    reversedEntries.filter((entry) => Boolean(entry.reverts)).length,
    3,
    'three reversal entries link back to the original ledger entries'
  );

  await invoice.delete();

  t.equal(
    await fyo.db.exists(ModelNameEnum.SalesInvoice, invoice.name!),
    true,
    'cancelled Norwegian invoice remains stored after delete attempt'
  );

  const entriesAfterDeleteAttempt = await fyo.db.getAllRaw(
    ModelNameEnum.AccountingLedgerEntry,
    {
      fields: ['name'],
      filters: { referenceName: invoice.name! },
    }
  );

  t.equal(
    entriesAfterDeleteAttempt.length,
    6,
    'audit-trail ledger entries remain stored after delete attempt'
  );
});

test.onFinish(async () => {
  await fyo.close();
});
