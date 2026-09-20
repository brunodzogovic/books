import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ModelNameEnum } from 'models/types';
import { buildNorwegianSaftFinancial140 } from 'regional/noSaft';
import setupInstance from 'src/setup/setupInstance';
import { initializeInstance } from 'src/utils/initialization';
import test from 'tape';
import { getTestFyo } from './helpers';

test('Norwegian company data survives close and reopen', async (t) => {
  const year = new Date().getFullYear();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'books-no-reopen-'));
  const dbPath = path.join(tempDir, 'cirrenix-test.books.db');
  const first = getTestFyo();

  try {
    await setupInstance(
      dbPath,
      {
        logo: null,
        companyName: 'CirreniX Reopen Test AS',
        country: 'Norway',
        fullname: 'Test Person',
        email: 'test@example.invalid',
        bankName: 'CirreniX Test Bank',
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
      first
    );

    t.equal(
      first.getField(ModelNameEnum.Account, 'saftGrouping')?.fieldtype,
      'AutoComplete',
      'on-disk setup includes Norwegian account schema'
    );
    t.ok(
      first.getField(ModelNameEnum.AccountingSettings, 'organizationNumber'),
      'on-disk setup includes Norwegian accounting settings schema'
    );
    t.equal(
      first.singles.AccountingSettings?.get('organizationNumber'),
      '123456785',
      'setup document holds Norwegian organization number before close'
    );

    const customAccount = first.doc.getNewDoc(ModelNameEnum.Account, {
      name: 'Cloud platform services - 67998',
      parentAccount: 'Andre driftskostnader',
      rootType: 'Expense',
    });
    await customAccount.sync();
    await customAccount.setAndSync(
      'saftGrouping',
      'annenDriftskostnad|6700'
    );
    t.equal(
      customAccount.get('saftGrouping'),
      'annenDriftskostnad|6700',
      'account document holds custom SAF-T grouping before close'
    );

    const storedBeforeClose = await first.db.get(
      ModelNameEnum.Account,
      customAccount.name!
    );
    t.equal(
      storedBeforeClose.saftGrouping,
      'annenDriftskostnad|6700',
      'custom SAF-T grouping is persisted before close'
    );

    const organizationBeforeClose = await first.db.getSingleValues({
      parent: ModelNameEnum.AccountingSettings,
      fieldname: 'organizationNumber',
    });
    t.equal(
      organizationBeforeClose[0]?.value,
      '123456785',
      'organization number is persisted before close'
    );

    const entry = first.doc.getNewDoc(ModelNameEnum.JournalEntry, {
      entryType: 'Journal Entry',
      date: new Date(`${year}-04-10T12:00:00.000Z`),
      referenceNumber: 'REOPEN-001',
      userRemark: 'Persistence test entry',
      accounts: [
        {
          account: customAccount.name,
          debit: 450,
          credit: 0,
        },
        {
          account: 'CirreniX Test Bank',
          debit: 0,
          credit: 450,
        },
      ],
    });
    await entry.runFormulas();
    await entry.sync();
    await entry.submit();
    await first.close();

    const reopened = getTestFyo();
    try {
      await initializeInstance(dbPath, false, '', reopened);

      t.equal(
        reopened.singles.SystemSettings?.countryCode,
        'no',
        'reopened database restores Norwegian country code'
      );
      t.equal(
        reopened.singles.SystemSettings?.currency,
        'NOK',
        'reopened database restores NOK company currency'
      );
      t.equal(
        reopened.singles.AccountingSettings?.companyName,
        'CirreniX Reopen Test AS',
        'reopened database restores company identity'
      );

      const reopenedOrganization = await reopened.db.getSingleValues({
        parent: ModelNameEnum.AccountingSettings,
        fieldname: 'organizationNumber',
      });
      t.equal(
        reopenedOrganization[0]?.value,
        '123456785',
        'raw organization number survives reopen'
      );
      t.equal(
        reopened.singles.AccountingSettings?.get('organizationNumber'),
        '123456785',
        'reopened accounting settings expose organization number'
      );
      t.equal(
        reopened.getField(ModelNameEnum.Account, 'saftGrouping')?.fieldtype,
        'AutoComplete',
        'reopened database loads Norwegian account schema extensions'
      );

      const storedAccount = await reopened.db.get(
        ModelNameEnum.Account,
        'Cloud platform services - 67998'
      );
      t.equal(
        storedAccount?.saftGrouping,
        'annenDriftskostnad|6700',
        'custom SAF-T account grouping survives reopen'
      );

      const ledgerRows = await reopened.db.getAllRaw(
        ModelNameEnum.AccountingLedgerEntry,
        {
          fields: ['account', 'debit', 'credit', 'referenceName'],
          filters: { referenceName: entry.name! },
        }
      );
      t.equal(
        ledgerRows.length,
        2,
        'posted ledger entries survive reopen'
      );

      const saft = await buildNorwegianSaftFinancial140(reopened, {
        fromDate: `${year}-01-01`,
        toDate: `${year}-12-31`,
        createdDate: `${year}-12-31`,
        softwareVersion: '0.37.0-test',
      });
      t.ok(
        saft.xml.includes('<AccountID>67998</AccountID>') &&
          saft.xml.includes('<GroupingCode>6700</GroupingCode>'),
        'reopened database remains exportable to SAF-T with custom grouping'
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await first.close().catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
