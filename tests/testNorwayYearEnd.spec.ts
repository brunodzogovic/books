import { BalanceSheet } from 'reports/BalanceSheet/BalanceSheet';
import { ProfitAndLoss } from 'reports/ProfitAndLoss/ProfitAndLoss';
import { getNorwegianVatSummary } from 'reports/NorwegianVAT/NorwegianVAT';
import { PurchaseInvoice } from 'models/baseModels/PurchaseInvoice/PurchaseInvoice';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { Payment } from 'models/baseModels/Payment/Payment';
import { Party } from 'models/baseModels/Party/Party';
import { JournalEntry } from 'models/baseModels/JournalEntry/JournalEntry';
import { ModelNameEnum } from 'models/types';
import { buildNorwegianSaftFinancial140 } from 'regional/noSaft';
import setupInstance from 'src/setup/setupInstance';
import test from 'tape';
import { getTestDbPath, getTestFyo } from './helpers';

const fyo = getTestFyo();
const dbPath = getTestDbPath();

const bankAccount = 'CirreniX Test Bank';
const customerName = 'CirreniX Test Customer AS';
const supplierName = 'CirreniX Test Supplier AS';
const consultingItemName = 'Cloud consulting';
const laptopItemName = 'Development laptop';
const hostingItemName = 'Cloud hosting';

async function postJournalEntry(
  date: Date,
  referenceNumber: string,
  remark: string,
  accounts: { account: string; debit: number; credit: number }[]
) {
  const entry = fyo.doc.getNewDoc(ModelNameEnum.JournalEntry, {
    entryType: 'Journal Entry',
    date,
    referenceNumber,
    userRemark: remark,
    accounts,
  }) as JournalEntry;

  await entry.runFormulas();
  await entry.sync();
  await entry.submit();
  return entry;
}

async function settleSalesInvoice(
  invoice: SalesInvoice,
  date: Date,
  referenceId: string
) {
  const payment = invoice.getPayment() as Payment;
  await payment.set({
    date,
    paymentMethod: 'Bank',
    paymentAccount: bankAccount,
    referenceId,
    clearanceDate: date,
  });
  await payment.runFormulas();
  await payment.sync();
  await payment.submit();
  return payment;
}

async function settlePurchaseInvoice(
  invoice: PurchaseInvoice,
  date: Date,
  referenceId: string
) {
  const payment = invoice.getPayment() as Payment;
  await payment.set({
    date,
    paymentMethod: 'Bank',
    account: bankAccount,
    referenceId,
    clearanceDate: date,
  });
  await payment.runFormulas();
  await payment.sync();
  await payment.submit();
  return payment;
}

test('Norwegian realistic full-year SME accounting regression', async (t) => {
  const year = new Date().getFullYear();

  await setupInstance(
    dbPath,
    {
      logo: null,
      companyName: 'CirreniX Test AS',
      country: 'Norway',
      fullname: 'Test Accountant',
      email: 'accounting@example.invalid',
      bankName: bankAccount,
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

  t.ok(
    await fyo.db.exists(ModelNameEnum.Account, bankAccount),
    'setup creates the operating bank account'
  );

  const customer = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: customerName,
    role: 'Customer',
    email: 'customer@example.invalid',
    organizationNumber: '987654325',
    vatRegistered: true,
  });
  await customer.runFormulas();
  await customer.sync();

  const supplier = fyo.doc.getNewDoc(ModelNameEnum.Party, {
    name: supplierName,
    role: 'Supplier',
    email: 'supplier@example.invalid',
    organizationNumber: '876543214',
    vatRegistered: true,
  });
  await supplier.runFormulas();
  await supplier.sync();

  const consultingItem = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: consultingItemName,
    itemType: 'Service',
    for: 'Sales',
    unit: 'Unit',
    rate: 50000,
    tax: 'Utgående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Varekostnad - 40000',
  });
  await consultingItem.sync();

  const laptopItem = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: laptopItemName,
    itemType: 'Product',
    for: 'Purchases',
    unit: 'Unit',
    rate: 10000,
    tax: 'Inngående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Kontormaskiner og IT-utstyr - 12800',
  });
  await laptopItem.sync();

  const hostingItem = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: hostingItemName,
    itemType: 'Service',
    for: 'Purchases',
    unit: 'Month',
    rate: 2000,
    tax: 'Inngående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Telefon og internett - 69000',
  });
  await hostingItem.sync();

  await postJournalEntry(
    new Date(`${year}-01-02T12:00:00.000Z`),
    'SHARE-CAPITAL-001',
    'Initial share capital paid into bank',
    [
      { account: bankAccount, debit: 30000, credit: 0 },
      { account: 'Aksjekapital - 20000', debit: 0, credit: 30000 },
    ]
  );

  const laptopInvoice = fyo.doc.getNewDoc(ModelNameEnum.PurchaseInvoice, {
    account: 'Leverandørgjeld - 24000',
    party: supplierName,
    date: new Date(`${year}-01-10T12:00:00.000Z`),
    items: [
      {
        item: laptopItemName,
        quantity: 1,
        rate: 10000,
        tax: 'Inngående MVA 25 %',
      },
    ],
  }) as PurchaseInvoice;
  await laptopInvoice.runFormulas();
  await laptopInvoice.sync();
  await laptopInvoice.submit();
  await settlePurchaseInvoice(
    laptopInvoice,
    new Date(`${year}-01-15T12:00:00.000Z`),
    'BANK-LAPTOP-001'
  );

  const consultingInvoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: customerName,
    date: new Date(`${year}-02-10T12:00:00.000Z`),
    dueDate: `${year}-02-24`,
    deliveryDate: `${year}-02-10T12:00:00.000Z`,
    deliveryPlace: 'Oslo',
    items: [
      {
        item: consultingItemName,
        quantity: 1,
        rate: 50000,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;
  await consultingInvoice.runFormulas();
  await consultingInvoice.sync();
  await consultingInvoice.submit();
  await settleSalesInvoice(
    consultingInvoice,
    new Date(`${year}-02-20T12:00:00.000Z`),
    'BANK-CONSULTING-001'
  );

  const hostingInvoice = fyo.doc.getNewDoc(ModelNameEnum.PurchaseInvoice, {
    account: 'Leverandørgjeld - 24000',
    party: supplierName,
    date: new Date(`${year}-03-10T12:00:00.000Z`),
    items: [
      {
        item: hostingItemName,
        quantity: 1,
        rate: 2000,
        tax: 'Inngående MVA 25 %',
      },
    ],
  }) as PurchaseInvoice;
  await hostingInvoice.runFormulas();
  await hostingInvoice.sync();
  await hostingInvoice.submit();
  await settlePurchaseInvoice(
    hostingInvoice,
    new Date(`${year}-03-15T12:00:00.000Z`),
    'BANK-HOSTING-001'
  );

  await postJournalEntry(
    new Date(`${year}-04-05T12:00:00.000Z`),
    'TRAVEL-001',
    'Customer meeting travel expense',
    [
      { account: 'Reisekostnader - 71400', debit: 3000, credit: 0 },
      { account: bankAccount, debit: 0, credit: 3000 },
    ]
  );

  const correctedInvoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
    account: 'Kundefordringer - 15000',
    party: customerName,
    date: new Date(`${year}-05-01T12:00:00.000Z`),
    dueDate: `${year}-05-15`,
    deliveryDate: `${year}-05-01T12:00:00.000Z`,
    deliveryPlace: 'Oslo',
    items: [
      {
        item: consultingItemName,
        quantity: 1,
        rate: 8000,
        tax: 'Utgående MVA 25 %',
      },
    ],
  }) as SalesInvoice;
  await correctedInvoice.runFormulas();
  await correctedInvoice.sync();
  await correctedInvoice.submit();

  const creditNote = (await correctedInvoice.getReturnDoc()) as SalesInvoice;
  await creditNote.set({
    date: new Date(`${year}-05-02T12:00:00.000Z`),
    correctionReason: 'Duplicate project invoice',
  });
  await creditNote.runFormulas();
  await creditNote.sync();
  await creditNote.submit();

  const customerAfterCredit = (await fyo.doc.getDoc(
    ModelNameEnum.Party,
    customerName
  )) as Party;
  await customerAfterCredit.load();

  t.equal(
    customerAfterCredit.outstandingAmount?.float,
    0,
    'unpaid invoice and full credit note net customer outstanding to zero'
  );

  const vatSummary = await getNorwegianVatSummary(
    fyo,
    `${year}-01-01`,
    `${year}-12-31`
  );
  const output25 = vatSummary.find(
    ({ standardTaxCode }) => standardTaxCode === '3'
  );
  const input25 = vatSummary.find(
    ({ standardTaxCode }) => standardTaxCode === '1'
  );

  t.equal(output25?.basis, 50000, 'year output VAT basis is NOK 50,000');
  t.equal(output25?.vatAmount, 12500, 'year output VAT is NOK 12,500');
  t.equal(input25?.basis, 12000, 'year input VAT basis is NOK 12,000');
  t.equal(input25?.vatAmount, 3000, 'year input VAT is NOK 3,000');

  const profitAndLoss = new ProfitAndLoss(fyo);
  profitAndLoss.basedOn = 'Until Date';
  profitAndLoss.toDate = `${year}-12-31`;
  profitAndLoss.count = 12;
  profitAndLoss.periodicity = 'Monthly';
  profitAndLoss.consolidateColumns = true;
  await profitAndLoss.initialize();

  const getTotal = (
    rows: typeof profitAndLoss.reportData,
    label: string
  ): number => {
    const row = rows.find(({ cells }) => cells[0]?.rawValue === label);
    return (row?.cells[1]?.rawValue as number | undefined) ?? 0;
  };

  const income = getTotal(
    profitAndLoss.reportData,
    'Total Income (Credit)'
  );
  const expense = getTotal(
    profitAndLoss.reportData,
    'Total Expense (Debit)'
  );
  const profit =
    getTotal(profitAndLoss.reportData, 'Total Profit') || income - expense;

  t.equal(income, 50000, 'full-year P&L reports NOK 50,000 income');
  t.equal(expense, 5000, 'full-year P&L reports NOK 5,000 operating expenses');
  t.equal(profit, 45000, 'full-year P&L reports NOK 45,000 profit');

  const balanceSheet = new BalanceSheet(fyo);
  balanceSheet.basedOn = 'Until Date';
  balanceSheet.toDate = `${year}-12-31`;
  balanceSheet.count = 12;
  balanceSheet.periodicity = 'Monthly';
  balanceSheet.consolidateColumns = true;
  await balanceSheet.initialize();

  const assets = getTotal(balanceSheet.reportData, 'Total Asset (Debit)');
  const liabilities = getTotal(
    balanceSheet.reportData,
    'Total Liability (Credit)'
  );
  const equity = getTotal(balanceSheet.reportData, 'Total Equity (Credit)');

  t.equal(assets, 84500, 'year-end assets are NOK 84,500');
  t.equal(liabilities, 9500, 'year-end liabilities are NOK 9,500');
  t.equal(equity, 30000, 'year-end contributed equity is NOK 30,000');
  t.equal(
    assets,
    liabilities + equity + profit,
    'year-end balance sheet reconciles with current-year profit'
  );

  const saft = await buildNorwegianSaftFinancial140(fyo, {
    fromDate: `${year}-01-01`,
    toDate: `${year}-12-31`,
    createdDate: `${year}-12-31`,
    softwareVersion: '0.37.0-test',
  });

  t.equal(
    saft.numberOfEntries,
    10,
    'realistic year exports ten accounting transactions'
  );
  t.equal(saft.totalDebit, 208000, 'realistic year SAF-T debit total is NOK 208,000');
  t.equal(
    saft.totalCredit,
    208000,
    'realistic year SAF-T credit total is NOK 208,000'
  );
  t.ok(
    saft.xml.includes('<AccountID>12800</AccountID>') &&
      saft.xml.includes('<GroupingCode>1280</GroupingCode>'),
    'SAF-T exports capitalized IT equipment with official grouping'
  );
  t.ok(
    saft.xml.includes('<VoucherType>SCN</VoucherType>') &&
      saft.xml.includes('Duplicate project invoice'),
    'SAF-T preserves the year credit-note correction trail'
  );

  await fyo.singles.AccountingSettings?.setAndSync(
    'accountingLockDate',
    new Date(`${year}-12-31T00:00:00.000Z`)
  );

  const lockedEntry = fyo.doc.getNewDoc(ModelNameEnum.JournalEntry, {
    entryType: 'Journal Entry',
    date: new Date(`${year}-12-31T12:00:00.000Z`),
    referenceNumber: 'LOCKED-001',
    userRemark: 'Must not post after year close',
    accounts: [
      { account: 'Kontorrekvisita - 68000', debit: 100, credit: 0 },
      { account: bankAccount, debit: 0, credit: 100 },
    ],
  }) as JournalEntry;

  await lockedEntry.runFormulas();
  await lockedEntry.sync();

  let lockBlocked = false;
  try {
    await lockedEntry.submit();
  } catch {
    lockBlocked = true;
  }

  t.equal(lockBlocked, true, 'year-end period lock blocks backdated posting');
});

test.onFinish(async () => {
  await fyo.close();
});
