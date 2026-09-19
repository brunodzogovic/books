import { Fyo } from 'fyo';
import { NORWEGIAN_TAX_TEMPLATES } from 'regional/noTaxCodes';

export async function createNorwegianRecords(fyo: Fyo) {
  const writeOffAccount = 'Tap på fordringer - 78300';
  if (await fyo.db.exists('Account', writeOffAccount)) {
    await fyo.singles.AccountingSettings?.setAndSync(
      'writeOffAccount',
      writeOffAccount
    );
  }

  for (const template of NORWEGIAN_TAX_TEMPLATES) {
    if (await fyo.db.exists('Tax', template.name)) {
      continue;
    }

    if (!(await fyo.db.exists('Account', template.account))) {
      continue;
    }

    const details = [{ account: template.account, rate: template.rate }];

    await fyo.doc
      .getNewDoc('Tax', {
        name: template.name,
        taxCode: template.taxCode,
        standardTaxCode: template.standardTaxCode,
        details,
      })
      .sync();
  }
}
