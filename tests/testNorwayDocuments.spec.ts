import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { ModelNameEnum } from 'models/types';
import setupInstance from 'src/setup/setupInstance';
import test from 'tape';
import { getTestDbPath, getTestFyo } from './helpers';

const fyo = getTestFyo();
const dbPath = getTestDbPath();

test('Norwegian sales documents keep a machine-controlled number sequence', async (t) => {
  const year = new Date().getFullYear();

  await setupInstance(
    dbPath,
    {
      logo: null,
      companyName: 'Norway Numbering Test AS',
      country: 'Norway',
      fullname: 'Test Person',
      email: 'numbering@example.invalid',
      bankName: 'Numbering Test Bank',
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
    name: 'Nummerert Kunde AS',
    role: 'Customer',
    email: 'kunde@example.invalid',
    organizationNumber: '987654325',
    vatRegistered: true,
  });
  await customer.runFormulas();
  await customer.sync();

  const item = fyo.doc.getNewDoc(ModelNameEnum.Item, {
    name: 'Nummerert konsulenttjeneste',
    itemType: 'Service',
    for: 'Sales',
    unit: 'Unit',
    rate: 1000,
    tax: 'Utgående MVA 25 %',
    incomeAccount: 'Salgsinntekt, avgiftspliktig, 25 % - 30000',
    expenseAccount: 'Varekostnad - 40000',
  });
  await item.sync();

  const makeInvoice = async () => {
    const invoice = fyo.doc.getNewDoc(ModelNameEnum.SalesInvoice, {
      account: 'Kundefordringer - 15000',
      party: customer.name,
      dueDate: `${year}-10-15`,
      deliveryDate: `${year}-09-20T12:00:00.000Z`,
      deliveryPlace: 'Oslo',
      date: new Date(`${year}-09-20T12:00:00.000Z`),
      items: [
        {
          item: item.name,
          quantity: 1,
          rate: 1000,
          tax: 'Utgående MVA 25 %',
        },
      ],
    }) as SalesInvoice;

    await invoice.runFormulas();
    await invoice.sync();
    await invoice.submit();
    return invoice;
  };

  const first = await makeInvoice();
  const second = await makeInvoice();

  t.equal(first.name, 'SINV-1001', 'first sales document receives SINV-1001');
  t.equal(second.name, 'SINV-1002', 'next sales document receives SINV-1002');

  await second.cancel('Duplicate invoice created during numbering test');
  t.equal(
    second.name,
    'SINV-1002',
    'cancelling a posted invoice preserves its assigned document number'
  );

  const creditNote = (await first.getReturnDoc()) as SalesInvoice;
  await creditNote.set(
    'correctionReason',
    'Full correction used to verify the sales-document sequence'
  );
  await creditNote.sync();
  await creditNote.submit();

  t.equal(
    creditNote.name,
    'SINV-1003',
    'credit note receives the next number in the sales-document sequence'
  );
  t.equal(
    creditNote.returnAgainst,
    'SINV-1001',
    'credit note retains the number of the document it corrects'
  );

  const fourth = await makeInvoice();
  t.equal(
    fourth.name,
    'SINV-1004',
    'new invoice continues after the credit note without reusing numbers'
  );

  const series = await fyo.doc.getDoc(ModelNameEnum.NumberSeries, 'SINV-');
  t.equal(
    series.get('current'),
    1004,
    'number-series state records the highest assigned sales-document number'
  );

  await first.rename('SINV-9999');
  t.equal(
    first.name,
    'SINV-1001',
    'submitted sales-document number cannot be renamed'
  );
  t.ok(
    await fyo.db.exists(ModelNameEnum.SalesInvoice, 'SINV-1001'),
    'original submitted document remains addressable by its assigned number'
  );
});

test.onFinish(async () => {
  await fyo.close();
});
