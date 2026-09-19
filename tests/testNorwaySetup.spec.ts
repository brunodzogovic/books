import { assertDoesNotThrow } from 'backend/database/tests/helpers';
import { DateTime } from 'luxon';
import setupInstance from 'src/setup/setupInstance';
import test from 'tape';
import { getTestDbPath, getTestFyo } from './helpers';

const fyo = getTestFyo();
const dbPath = getTestDbPath();

test('setup Norwegian company', async (t) => {
  const year = DateTime.local().year;

  await assertDoesNotThrow(async () => {
    await setupInstance(
      dbPath,
      {
        logo: null,
        companyName: 'Norway Test AS',
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
  }, 'Norwegian setup failed');

  t.equal(fyo.singles.SystemSettings?.currency, 'NOK');
  t.equal(fyo.singles.SystemSettings?.countryCode, 'no');
  t.equal(fyo.singles.AccountingSettings?.organizationNumber, '123456785');
  t.equal(fyo.singles.AccountingSettings?.organizationForm, 'AS');
  t.equal(fyo.singles.AccountingSettings?.vatRegistered, true);

  t.ok(await fyo.db.exists('Account', 'Kundefordringer - 15000'));
  t.ok(await fyo.db.exists('Account', 'Leverandørgjeld - 24000'));
  t.ok(await fyo.db.exists('Account', 'Utgående MVA, 25 % - 27000'));
  t.ok(await fyo.db.exists('Account', 'Inngående MVA, 25 % - 27100'));
  t.ok(await fyo.db.exists('Tax', 'Utgående MVA 25 %'));
  t.ok(await fyo.db.exists('Tax', 'Inngående MVA 25 %'));
  t.ok(await fyo.db.exists('Tax', 'MVA 0 % (fritatt)'));
});

test.onFinish(async () => {
  await fyo.close();
});
