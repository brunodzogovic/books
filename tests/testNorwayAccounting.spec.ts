import setupInstance from 'src/setup/setupInstance';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
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
  });
  await customer.runFormulas();
  await customer.sync();

  t.equal(
    customer.defaultAccount,
    receivableAccount,
    'customer defaults to Norwegian receivables account'
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
  }) as import('models/baseModels/PurchaseInvoice/PurchaseInvoice').PurchaseInvoice;

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

test.onFinish(async () => {
  await fyo.close();
});
