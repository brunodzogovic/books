import { NORWEGIAN_TAX_TEMPLATES } from 'regional/noTaxCodes';
import { DatabaseManager } from '../database/manager';

async function execute(dm: DatabaseManager) {
  const db = dm.db;
  if (!db?.knex) {
    return;
  }

  const countryCodeRows = await db.getSingleValues({
    fieldname: 'countryCode',
    parent: 'SystemSettings',
  });

  if (countryCodeRows[0]?.value !== 'no') {
    return;
  }

  const columns = (await db.knex.raw('PRAGMA table_info(Tax)')) as {
    name: string;
  }[];

  const columnNames = new Set(columns.map(({ name }) => name));
  if (!columnNames.has('taxCode') || !columnNames.has('standardTaxCode')) {
    return;
  }

  for (const template of NORWEGIAN_TAX_TEMPLATES) {
    await db.knex('Tax').where({ name: template.name }).update({
      taxCode: template.taxCode,
      standardTaxCode: template.standardTaxCode,
    });
  }
}

export default { execute };
