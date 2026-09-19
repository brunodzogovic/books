export type NorwegianTaxTemplate = {
  name: string;
  taxCode: string;
  standardTaxCode: string;
  account: string;
  rate: number;
};

export const NORWEGIAN_TAX_TEMPLATES: NorwegianTaxTemplate[] = [
  {
    name: 'Utgående MVA 25 %',
    taxCode: 'NO-OUT-25',
    standardTaxCode: '3',
    account: 'Utgående MVA, 25 % - 27000',
    rate: 25,
  },
  {
    name: 'Utgående MVA 15 %',
    taxCode: 'NO-OUT-15',
    standardTaxCode: '31',
    account: 'Utgående MVA, 15 % - 27010',
    rate: 15,
  },
  {
    name: 'Utgående MVA 12 %',
    taxCode: 'NO-OUT-12',
    standardTaxCode: '33',
    account: 'Utgående MVA, 12 % - 27020',
    rate: 12,
  },
  {
    name: 'Inngående MVA 25 %',
    taxCode: 'NO-IN-25',
    standardTaxCode: '1',
    account: 'Inngående MVA, 25 % - 27100',
    rate: 25,
  },
  {
    name: 'Inngående MVA 15 %',
    taxCode: 'NO-IN-15',
    standardTaxCode: '11',
    account: 'Inngående MVA, 15 % - 27110',
    rate: 15,
  },
  {
    name: 'Inngående MVA 12 %',
    taxCode: 'NO-IN-12',
    standardTaxCode: '13',
    account: 'Inngående MVA, 12 % - 27120',
    rate: 12,
  },
  {
    name: 'MVA 0 % (fritatt)',
    taxCode: 'NO-ZERO-DOM',
    standardTaxCode: '5',
    account: 'Oppgjørskonto MVA - 27400',
    rate: 0,
  },
  {
    name: 'Unntatt MVA',
    taxCode: 'NO-OUTSIDE',
    standardTaxCode: '6',
    account: 'Oppgjørskonto MVA - 27400',
    rate: 0,
  },
];
