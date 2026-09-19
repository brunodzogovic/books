import { Fyo } from 'fyo';

type TaxTemplate = {
  name: string;
  account?: string;
  rate?: number;
};

const TAX_TEMPLATES: TaxTemplate[] = [
  { name: 'Utgående MVA 25 %', account: 'Utgående MVA, 25 % - 27000', rate: 25 },
  { name: 'Utgående MVA 15 %', account: 'Utgående MVA, 15 % - 27010', rate: 15 },
  { name: 'Utgående MVA 12 %', account: 'Utgående MVA, 12 % - 27020', rate: 12 },
  { name: 'Inngående MVA 25 %', account: 'Inngående MVA, 25 % - 27100', rate: 25 },
  { name: 'Inngående MVA 15 %', account: 'Inngående MVA, 15 % - 27110', rate: 15 },
  { name: 'Inngående MVA 12 %', account: 'Inngående MVA, 12 % - 27120', rate: 12 },
  {
    name: 'MVA 0 % (fritatt)',
    account: 'Oppgjørskonto MVA - 27400',
    rate: 0,
  },
  {
    name: 'Unntatt MVA',
    account: 'Oppgjørskonto MVA - 27400',
    rate: 0,
  },
];

export async function createNorwegianRecords(fyo: Fyo) {
  for (const template of TAX_TEMPLATES) {
    if (await fyo.db.exists('Tax', template.name)) {
      continue;
    }

    if (template.account && !(await fyo.db.exists('Account', template.account))) {
      continue;
    }

    const details =
      template.account && typeof template.rate === 'number'
        ? [{ account: template.account, rate: template.rate }]
        : [];

    await fyo.doc.getNewDoc('Tax', { name: template.name, details }).sync();
  }
}
