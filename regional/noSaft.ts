import { Fyo, t } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';
import { Invoice } from 'models/baseModels/Invoice/Invoice';
import { Payment } from 'models/baseModels/Payment/Payment';
import { JournalEntry } from 'models/baseModels/JournalEntry/JournalEntry';

const SAF_T_NAMESPACE = 'urn:StandardAuditFile-Taxation-Financial:NO';
export const NORWEGIAN_SAF_T_VERSION = '1.40';

export type NorwegianSaftExportOptions = {
  fromDate: string;
  toDate: string;
  createdDate?: string | Date;
  softwareCompanyName?: string;
  softwareId?: string;
  softwareVersion?: string;
};

type RawLedgerRow = {
  name: string | number;
  date: string | Date;
  account: string;
  debit: string | number | null;
  credit: string | number | null;
  referenceType: string;
  referenceName: string;
  party?: string | null;
  reverted?: boolean | number;
  reverts?: string | number | null;
};

type TransactionGroup = {
  id: string;
  date: string;
  referenceType: string;
  referenceName: string;
  isReversal: boolean;
  rows: RawLedgerRow[];
};

type SaftParty = {
  name: string;
  role: string;
  organizationNumber?: string;
  defaultAccount?: string;
};

type SaftTax = {
  name: string;
  taxCode: string;
  standardTaxCode: string;
  rate: number;
};

type SaftPartyBalance = {
  accountId: string;
  opening: number;
  closing: number;
};

type SaftLineTaxInformation = {
  taxCode: string;
  rate: number;
  taxBase: number;
  taxAmount: number;
  currency?: string;
  foreignTaxBase?: number;
  foreignTaxAmount?: number;
  exchangeRate?: number;
};

type SaftForeignAmount = {
  currency: string;
  exchangeRate: number;
};

type SaftAccount = {
  name: string;
  accountType?: string;
  rootType?: string;
  isGroup?: boolean | number;
};

type SaftGrouping = {
  category: string;
  code: string;
};

type SaftTransactionContext = {
  voucher: {
    type: string;
    description: string;
  };
  description: string;
  referenceNumber: string;
  sourceDocumentId?: string;
  sourceDocumentOnSubledgerOnly?: boolean;
};

export type NorwegianSaftExportResult = {
  xml: string;
  numberOfEntries: number;
  totalDebit: number;
  totalCredit: number;
};

/**
 * SAF-T Financial 1.40 foundation.
 *
 * Authoritative schema:
 * https://github.com/Skatteetaten/saf-t/blob/master/SAF-T_Financial_1.4/Norwegian_SAF-T_Financial_Schema_v_1.40.xsd
 *
 * Version notes:
 * https://github.com/Skatteetaten/saf-t/blob/master/SAF-T_Financial_1.4/About_SAF-T_Financial_schema_v.1.40.txt
 */
export async function buildNorwegianSaftFinancial140(
  fyo: Fyo,
  options: NorwegianSaftExportOptions
): Promise<NorwegianSaftExportResult> {
  if (fyo.singles.SystemSettings?.countryCode !== 'no') {
    throw new ValidationError(
      t`Norwegian SAF-T export is only available for Norwegian companies.`
    );
  }

  const fromDate = normalizeDate(options.fromDate);
  const toDate = normalizeDate(options.toDate);
  if (fromDate > toDate) {
    throw new ValidationError(t`SAF-T start date must not be after end date.`);
  }

  const accounting = fyo.singles.AccountingSettings;
  const system = fyo.singles.SystemSettings;
  const companyName = String(accounting?.companyName ?? '').trim();
  const organizationNumber = String(
    accounting?.organizationNumber ?? ''
  ).trim();
  const contactName = String(
    accounting?.fullname ?? companyName ?? 'NotUsed'
  ).trim();
  const email = String(accounting?.email ?? '').trim();
  const currency = String(system?.currency ?? 'NOK').trim();

  if (!companyName || !organizationNumber) {
    throw new ValidationError(
      t`Company name and organization number are required for Norwegian SAF-T export.`
    );
  }

  const rawRows = (await fyo.db.getAllRaw('AccountingLedgerEntry', {
    fields: [
      'name',
      'date',
      'account',
      'debit',
      'credit',
      'referenceType',
      'referenceName',
      'party',
      'reverted',
      'reverts',
    ],
    orderBy: ['date', 'name'],
    order: 'asc',
  })) as unknown as RawLedgerRow[];

  const selectedRows = rawRows.filter((row) => {
    const date = normalizeDate(row.date);
    return date >= fromDate && date <= toDate;
  });

  const groups = groupTransactions(selectedRows);
  validateBalancedTransactions(groups);

  const totalDebit = roundMoney(
    selectedRows.reduce((sum, row) => sum + toAmount(row.debit), 0)
  );
  const totalCredit = roundMoney(
    selectedRows.reduce((sum, row) => sum + toAmount(row.credit), 0)
  );

  if (!moneyEquals(totalDebit, totalCredit)) {
    throw new ValidationError(
      t`SAF-T general ledger totals are not balanced.`
    );
  }

  const createdDate = normalizeDate(options.createdDate ?? new Date());
  const softwareCompanyName =
    options.softwareCompanyName?.trim() || 'CirreniX';
  const softwareId =
    options.softwareId?.trim() || 'Frappe Books Norwegian Localization';
  const softwareVersion =
    options.softwareVersion?.trim() ||
    String(fyo.store.appVersion ?? '0.37.0');

  const header = buildHeaderXml({
    createdDate,
    softwareCompanyName,
    softwareId,
    softwareVersion,
    companyName,
    organizationNumber,
    contactName: contactName || companyName,
    email,
    currency,
    fromDate,
    toDate,
  });

  const parties = await loadSaftParties(fyo);
  const masterFiles = await buildMasterFilesXml(
    fyo,
    parties,
    rawRows,
    fromDate,
    toDate
  );

  const generalLedgerEntries = await buildGeneralLedgerEntriesXml(
    fyo,
    groups,
    totalDebit,
    totalCredit,
    parties
  );

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<AuditFile xmlns="${SAF_T_NAMESPACE}">`,
    header,
    masterFiles,
    generalLedgerEntries,
    '</AuditFile>',
    '',
  ].join('\n');

  return {
    xml,
    numberOfEntries: groups.length,
    totalDebit,
    totalCredit,
  };
}

function buildHeaderXml(values: {
  createdDate: string;
  softwareCompanyName: string;
  softwareId: string;
  softwareVersion: string;
  companyName: string;
  organizationNumber: string;
  contactName: string;
  email: string;
  currency: string;
  fromDate: string;
  toDate: string;
}): string {
  const contactLines = [
    '      <Contact>',
    '        <ContactPerson>',
    '          <FirstName>NotUsed</FirstName>',
    `          <LastName>${escapeXml(values.contactName)}</LastName>`,
    '        </ContactPerson>',
  ];

  if (values.email) {
    contactLines.push(
      `        <Email>${escapeXml(values.email)}</Email>`
    );
  }
  contactLines.push('      </Contact>');

  return [
    '  <Header>',
    `    <AuditFileVersion>${NORWEGIAN_SAF_T_VERSION}</AuditFileVersion>`,
    '    <AuditFileCountry>NO</AuditFileCountry>',
    `    <AuditFileDateCreated>${values.createdDate}</AuditFileDateCreated>`,
    `    <SoftwareCompanyName>${escapeXml(
      values.softwareCompanyName
    )}</SoftwareCompanyName>`,
    `    <SoftwareID>${escapeXml(values.softwareId)}</SoftwareID>`,
    `    <SoftwareVersion>${escapeXml(
      values.softwareVersion
    )}</SoftwareVersion>`,
    '    <Company>',
    `      <RegistrationNumber>${escapeXml(
      values.organizationNumber
    )}</RegistrationNumber>`,
    `      <Name>${escapeXml(values.companyName)}</Name>`,
    ...contactLines,
    '    </Company>',
    `    <DefaultCurrencyCode>${escapeXml(
      values.currency
    )}</DefaultCurrencyCode>`,
    '    <SelectionCriteria>',
    `      <SelectionStartDate>${values.fromDate}</SelectionStartDate>`,
    `      <SelectionEndDate>${values.toDate}</SelectionEndDate>`,
    '    </SelectionCriteria>',
    '    <TaxAccountingBasis>A</TaxAccountingBasis>',
    '  </Header>',
  ].join('\n');
}

async function buildGeneralLedgerAccountsXml(
  fyo: Fyo,
  rawRows: RawLedgerRow[],
  fromDate: string,
  toDate: string
): Promise<string[]> {
  const accountRows = (await fyo.db.getAllRaw('Account', {
    fields: ['name', 'accountType', 'rootType', 'isGroup'],
    orderBy: 'name',
    order: 'asc',
  })) as unknown as SaftAccount[];

  const accountMap = new Map(accountRows.map((account) => [account.name, account]));
  const usedAccountNames = [
    ...new Set(
      rawRows
        .filter((row) => normalizeDate(row.date) <= toDate)
        .map((row) => row.account)
    ),
  ].sort();

  const lines: string[] = [];

  for (const accountName of usedAccountNames) {
    const account = accountMap.get(accountName);
    if (!account) {
      throw new ValidationError(
        t`SAF-T account ${accountName} does not exist in the chart of accounts.`
      );
    }

    const grouping = getNorwegianSaftGrouping(account);
    const accountRowsForBalance = rawRows.filter(
      (row) => row.account === accountName
    );
    const opening = roundMoney(
      accountRowsForBalance
        .filter((row) => normalizeDate(row.date) < fromDate)
        .reduce((sum, row) => sum + getSignedLedgerAmount(row), 0)
    );
    const closing = roundMoney(
      accountRowsForBalance
        .filter((row) => normalizeDate(row.date) <= toDate)
        .reduce((sum, row) => sum + getSignedLedgerAmount(row), 0)
    );

    lines.push(
      '      <Account>',
      `        <AccountID>${escapeXml(getSaftAccountId(accountName))}</AccountID>`,
      `        <AccountDescription>${escapeXml(
        getSaftAccountDescription(accountName)
      )}</AccountDescription>`,
      `        <GroupingCategory>${escapeXml(
        grouping.category
      )}</GroupingCategory>`,
      `        <GroupingCode>${escapeXml(grouping.code)}</GroupingCode>`,
      '        <AccountType>GL</AccountType>',
      ...buildBalanceChoiceXml('Opening', opening, '        '),
      ...buildBalanceChoiceXml('Closing', closing, '        '),
      '      </Account>'
    );
  }

  return lines;
}

export const NORWEGIAN_SME_SAFT_GROUPING_BY_ACCOUNT: Record<
  string,
  SaftGrouping
> = {
  '12000': { category: 'balanseverdiForAnleggsmiddel', code: '1205' },
  '12500': { category: 'balanseverdiForAnleggsmiddel', code: '1205' },
  '12800': { category: 'balanseverdiForAnleggsmiddel', code: '1280' },
  '12900': { category: 'balanseverdiForAnleggsmiddel', code: '1290' },
  '12990': { category: 'balanseverdiForAnleggsmiddel', code: '1295' },

  '14000': { category: 'balanseverdiForOmloepsmiddel', code: '1400' },
  '15000': { category: 'balanseverdiForOmloepsmiddel', code: '1500' },
  '15700': { category: 'balanseverdiForOmloepsmiddel', code: '1570' },
  '17000': { category: 'balanseverdiForOmloepsmiddel', code: '1570' },
  '19000': { category: 'balanseverdiForOmloepsmiddel', code: '1900' },
  '19200': { category: 'balanseverdiForOmloepsmiddel', code: '1920' },
  '19990': { category: 'balanseverdiForOmloepsmiddel', code: '1570' },

  '20000': { category: 'egenkapital', code: '2000' },
  '20200': { category: 'egenkapital', code: '2020' },
  '20500': { category: 'egenkapital', code: '2050' },
  '20800': { category: 'egenkapital', code: '2080' },

  '22400': { category: 'langsiktigGjeld', code: '2220' },
  '24000': { category: 'kortsiktigGjeld', code: '2400' },
  '25000': { category: 'kortsiktigGjeld', code: '2500' },
  '26000': { category: 'kortsiktigGjeld', code: '2600' },
  '27000': { category: 'kortsiktigGjeld', code: '2740' },
  '27010': { category: 'kortsiktigGjeld', code: '2740' },
  '27020': { category: 'kortsiktigGjeld', code: '2740' },
  '27100': { category: 'kortsiktigGjeld', code: '2740' },
  '27110': { category: 'kortsiktigGjeld', code: '2740' },
  '27120': { category: 'kortsiktigGjeld', code: '2740' },
  '27400': { category: 'kortsiktigGjeld', code: '2740' },
  '27700': { category: 'kortsiktigGjeld', code: '2770' },
  '29300': { category: 'kortsiktigGjeld', code: '2949' },
  '29400': { category: 'kortsiktigGjeld', code: '2949' },
  '29600': { category: 'kortsiktigGjeld', code: '2980' },
  '29610': { category: 'kortsiktigGjeld', code: '2990' },
  '29900': { category: 'kortsiktigGjeld', code: '2990' },

  '30000': { category: 'salgsinntekt', code: '3000' },
  '31000': { category: 'salgsinntekt', code: '3000' },
  '32000': { category: 'salgsinntekt', code: '3100' },
  '39000': { category: 'annenDriftsinntekt', code: '3900' },

  '40000': { category: 'varekostnad', code: '4005' },
  '40900': { category: 'varekostnad', code: '4005' },
  '43900': { category: 'varekostnad', code: '4295' },

  '50000': { category: 'loennskostnad', code: '5000' },
  '50900': { category: 'loennskostnad', code: '5000' },
  '54000': { category: 'loennskostnad', code: '5400' },
  '59000': { category: 'loennskostnad', code: '5900' },

  '60000': { category: 'annenDriftskostnad', code: '6000' },
  '63000': { category: 'annenDriftskostnad', code: '6300' },
  '65000': { category: 'annenDriftskostnad', code: '6500' },
  '65500': { category: 'annenDriftskostnad', code: '7700' },
  '67000': { category: 'annenDriftskostnad', code: '6700' },
  '68000': { category: 'annenDriftskostnad', code: '6995' },
  '69000': { category: 'annenDriftskostnad', code: '6995' },
  '71400': { category: 'annenDriftskostnad', code: '7165' },
  '73200': { category: 'annenDriftskostnad', code: '7330' },
  '75000': { category: 'annenDriftskostnad', code: '7500' },
  '77400': { category: 'annenDriftskostnad', code: '7700' },
  '77700': { category: 'annenDriftskostnad', code: '7700' },
  '77900': { category: 'annenDriftskostnad', code: '7700' },
  '78300': { category: 'annenDriftskostnad', code: '7830' },

  '80500': { category: 'finansinntekt', code: '8050' },
  '81500': { category: 'finanskostnad', code: '8150' },
  '83000': { category: 'skattekostnad', code: '8300' },
};

/**
 * Mapping follows Skatteetaten's Grouping Category Code 2025-2026 codelist.
 * The CirreniX/Frappe Books starter chart intentionally uses a compact,
 * conventional account set, so several local accounts map to the closest
 * applicable official grouping code rather than sharing the same account
 * number as that code.
 */
export function getNorwegianSaftGrouping(account: SaftAccount): SaftGrouping {
  const accountId = getSaftAccountId(account.name);

  const accountTypeMap: Record<string, SaftGrouping> = {
    Receivable: {
      category: 'balanseverdiForOmloepsmiddel',
      code: '1500',
    },
    Payable: {
      category: 'kortsiktigGjeld',
      code: '2400',
    },
    Bank: {
      category: 'balanseverdiForOmloepsmiddel',
      code: '1920',
    },
    Cash: {
      category: 'balanseverdiForOmloepsmiddel',
      code: '1900',
    },
    Tax: {
      category: 'kortsiktigGjeld',
      code: '2740',
    },
  };

  if (account.accountType && accountTypeMap[account.accountType]) {
    return accountTypeMap[account.accountType];
  }

  const grouping = NORWEGIAN_SME_SAFT_GROUPING_BY_ACCOUNT[accountId];
  if (grouping) {
    return grouping;
  }

  throw new ValidationError(
    t`SAF-T grouping mapping is missing for account ${account.name}.`
  );
}

function getSaftAccountDescription(accountName: string): string {
  return accountName.replace(/ - \d{4,}$/, '').trim() || accountName;
}

async function loadSaftParties(fyo: Fyo): Promise<SaftParty[]> {
  return (await fyo.db.getAllRaw('Party', {
    fields: ['name', 'role', 'organizationNumber', 'defaultAccount'],
    orderBy: 'name',
    order: 'asc',
  })) as unknown as SaftParty[];
}

async function loadSaftTaxes(
  fyo: Fyo,
  rawRows: RawLedgerRow[],
  fromDate: string,
  toDate: string
): Promise<SaftTax[]> {
  const taxes = new Map<string, SaftTax>();

  const addTax = (tax: SaftTax) => {
    const key = [tax.taxCode, tax.standardTaxCode, tax.rate].join('|');
    taxes.set(key, tax);
  };

  const taxRows = (await fyo.db.getAllRaw('Tax', {
    fields: ['name', 'taxCode', 'standardTaxCode'],
    orderBy: 'name',
    order: 'asc',
  })) as unknown as {
    name: string;
    taxCode?: string;
    standardTaxCode?: string;
  }[];

  for (const row of taxRows) {
    const taxCode = String(row.taxCode ?? '').trim();
    const standardTaxCode = String(row.standardTaxCode ?? '').trim();

    if (!taxCode || !standardTaxCode) {
      continue;
    }

    const tax = await fyo.doc.getDoc('Tax', row.name);
    const details =
      (tax.get('details') as { get(fieldname: string): unknown }[] | undefined) ??
      [];
    const firstDetail = details.find(
      (detail) => typeof detail.get('rate') === 'number'
    );

    if (!firstDetail) {
      continue;
    }

    addTax({
      name: row.name,
      taxCode,
      standardTaxCode,
      rate: Number(firstDetail.get('rate')),
    });
  }

  /*
   * A posted Norwegian invoice carries an immutable VAT snapshot. Include
   * every historical code used by transactions in the export period so later
   * edits to a Tax template cannot leave journal-line TaxCode values without a
   * matching TaxTable entry.
   */
  const invoiceReferences = new Map<string, string>();
  for (const row of rawRows) {
    const date = normalizeDate(row.date);
    if (date < fromDate || date > toDate) {
      continue;
    }

    if (
      row.referenceType !== 'SalesInvoice' &&
      row.referenceType !== 'PurchaseInvoice'
    ) {
      continue;
    }

    invoiceReferences.set(
      `${row.referenceType}|${row.referenceName}`,
      row.referenceType
    );
  }

  for (const reference of invoiceReferences.keys()) {
    const [referenceType, referenceName] = reference.split('|');
    const invoice = (await fyo.doc.getDoc(
      referenceType,
      referenceName
    )) as Invoice;

    for (const taxItem of await invoice.getTaxItems()) {
      const taxCode = taxItem.taxCode?.trim();
      const standardTaxCode = taxItem.standardTaxCode?.trim();

      if (!taxCode || !standardTaxCode) {
        throw new ValidationError(
          t`SAF-T historical VAT mapping is incomplete for ${referenceType} ${referenceName}.`
        );
      }

      addTax({
        name: taxItem.tax,
        taxCode,
        standardTaxCode,
        rate: taxItem.details.rate,
      });
    }
  }

  return [...taxes.values()].sort((a, b) => {
    const standardCompare = a.standardTaxCode.localeCompare(b.standardTaxCode);
    if (standardCompare) {
      return standardCompare;
    }

    const codeCompare = a.taxCode.localeCompare(b.taxCode);
    if (codeCompare) {
      return codeCompare;
    }

    return a.rate - b.rate;
  });
}

async function buildMasterFilesXml(
  fyo: Fyo,
  parties: SaftParty[],
  rawRows: RawLedgerRow[],
  fromDate: string,
  toDate: string
): Promise<string> {
  const customers = parties.filter(
    ({ role }) => role === 'Customer' || role === 'Both'
  );
  const suppliers = parties.filter(
    ({ role }) => role === 'Supplier' || role === 'Both'
  );

  const taxes = await loadSaftTaxes(
    fyo,
    rawRows,
    fromDate,
    toDate
  );

  const lines = ['  <MasterFiles>'];

  const generalLedgerAccounts = await buildGeneralLedgerAccountsXml(
    fyo,
    rawRows,
    fromDate,
    toDate
  );
  if (generalLedgerAccounts.length) {
    lines.push('    <GeneralLedgerAccounts>', ...generalLedgerAccounts, '    </GeneralLedgerAccounts>');
  }

  if (customers.length) {
    lines.push('    <Customers>');
    for (const party of customers) {
      lines.push(
        ...buildPartyXml(
          party,
          'Customer',
          getPartyBalance(party, rawRows, fromDate, toDate)
        )
      );
    }
    lines.push('    </Customers>');
  }

  if (suppliers.length) {
    lines.push('    <Suppliers>');
    for (const party of suppliers) {
      lines.push(
        ...buildPartyXml(
          party,
          'Supplier',
          getPartyBalance(party, rawRows, fromDate, toDate)
        )
      );
    }
    lines.push('    </Suppliers>');
  }

  if (taxes.length) {
    lines.push(
      '    <TaxTable>',
      '      <TaxTableEntry>',
      '        <TaxType>MVA</TaxType>',
      '        <Description>Merverdiavgift</Description>'
    );

    for (const tax of taxes) {
      lines.push(
        '        <TaxCodeDetails>',
        `          <TaxCode>${escapeXml(tax.taxCode)}</TaxCode>`,
        `          <Description>${escapeXml(tax.name)}</Description>`,
        `          <TaxPercentage>${formatRate(tax.rate)}</TaxPercentage>`,
        '          <Country>NO</Country>',
        `          <StandardTaxCode>${escapeXml(
          tax.standardTaxCode
        )}</StandardTaxCode>`,
        '          <BaseRate>100</BaseRate>',
        '        </TaxCodeDetails>'
      );
    }

    lines.push('      </TaxTableEntry>', '    </TaxTable>');
  }

  lines.push('  </MasterFiles>');
  return lines.join('\n');
}

function buildPartyXml(
  party: SaftParty,
  kind: 'Customer' | 'Supplier',
  balance: SaftPartyBalance | null
): string[] {
  const id = getSaftPartyId(party);
  const lines = [`      <${kind}>`];

  if (party.organizationNumber) {
    lines.push(
      `        <RegistrationNumber>${escapeXml(
        party.organizationNumber
      )}</RegistrationNumber>`
    );
  }

  lines.push(
    `        <Name>${escapeXml(party.name)}</Name>`,
    `        <${kind}ID>${escapeXml(id)}</${kind}ID>`
  );

  if (balance) {
    lines.push(
      '        <BalanceAccount>',
      `          <AccountID>${escapeXml(balance.accountId)}</AccountID>`,
      ...buildBalanceChoiceXml('Opening', balance.opening, '          '),
      ...buildBalanceChoiceXml('Closing', balance.closing, '          '),
      '        </BalanceAccount>'
    );
  }

  lines.push(`      </${kind}>`);
  return lines;
}

function getPartyBalance(
  party: SaftParty,
  rows: RawLedgerRow[],
  fromDate: string,
  toDate: string
): SaftPartyBalance | null {
  if (!party.defaultAccount) {
    return null;
  }

  const partyRows = rows.filter(
    (row) =>
      row.party === party.name &&
      row.account === party.defaultAccount
  );

  const opening = roundMoney(
    partyRows
      .filter((row) => normalizeDate(row.date) < fromDate)
      .reduce((sum, row) => sum + getSignedLedgerAmount(row), 0)
  );

  const closing = roundMoney(
    partyRows
      .filter((row) => normalizeDate(row.date) <= toDate)
      .reduce((sum, row) => sum + getSignedLedgerAmount(row), 0)
  );

  return {
    accountId: getSaftAccountId(party.defaultAccount),
    opening,
    closing,
  };
}

function buildBalanceChoiceXml(
  prefix: 'Opening' | 'Closing',
  balance: number,
  indent: string
): string[] {
  if (balance < 0) {
    return [
      `${indent}<${prefix}CreditBalance>${formatMoney(
        Math.abs(balance)
      )}</${prefix}CreditBalance>`,
    ];
  }

  return [
    `${indent}<${prefix}DebitBalance>${formatMoney(
      balance
    )}</${prefix}DebitBalance>`,
  ];
}

function getSignedLedgerAmount(row: RawLedgerRow): number {
  return toAmount(row.debit) - toAmount(row.credit);
}

export function getSaftPartyId(party: SaftParty): string {
  const organizationNumber = String(party.organizationNumber ?? '').trim();
  if (organizationNumber) {
    return organizationNumber.slice(0, 35);
  }

  const normalized = party.name.trim();
  if (!normalized) {
    throw new ValidationError(t`SAF-T party is missing a name.`);
  }

  return normalized.slice(0, 35);
}

function formatRate(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return String(value);
}

async function buildGeneralLedgerEntriesXml(
  fyo: Fyo,
  groups: TransactionGroup[],
  totalDebit: number,
  totalCredit: number,
  parties: SaftParty[]
): Promise<string> {
  const lines = [
    '  <GeneralLedgerEntries>',
    `    <NumberOfEntries>${groups.length}</NumberOfEntries>`,
    `    <TotalDebit>${formatMoney(totalDebit)}</TotalDebit>`,
    `    <TotalCredit>${formatMoney(totalCredit)}</TotalCredit>`,
  ];

  if (groups.length) {
    lines.push(
      '    <Journal>',
      '      <JournalID>A001</JournalID>',
      '      <Description>Frappe Books general ledger</Description>',
      '      <Type>A</Type>'
    );

    for (const group of groups) {
      lines.push(...(await buildTransactionXml(fyo, group, parties)));
    }

    lines.push('    </Journal>');
  }

  lines.push('  </GeneralLedgerEntries>');
  return lines.join('\n');
}

async function buildTransactionXml(
  fyo: Fyo,
  group: TransactionGroup,
  parties: SaftParty[]
): Promise<string[]> {
  const date = group.date;
  const period = Number(date.slice(5, 7));
  const year = Number(date.slice(0, 4));
  const context = await getTransactionContext(fyo, group);
  const voucher = context.voucher;
  const taxInformationByAccount = await getTransactionTaxInformation(
    fyo,
    group
  );
  const foreignAmount = await getTransactionForeignAmount(fyo, group);

  const lines = [
    '      <Transaction>',
    `        <TransactionID>${escapeXml(group.id)}</TransactionID>`,
    `        <Period>${period}</Period>`,
    `        <PeriodYear>${year}</PeriodYear>`,
    `        <TransactionDate>${date}</TransactionDate>`,
    `        <VoucherType>${voucher.type}</VoucherType>`,
    `        <VoucherDescription>${escapeXml(
      voucher.description
    )}</VoucherDescription>`,
    `        <TransactionType>${
      group.isReversal ? 'Reversal' : 'Normal'
    }</TransactionType>`,
    `        <Description>${escapeXml(context.description)}</Description>`,
    `        <SystemEntryDate>${date}</SystemEntryDate>`,
    `        <GLPostingDate>${date}</GLPostingDate>`,
  ];

  for (const row of group.rows) {
    lines.push(
      ...buildLineXml(
        row,
        group,
        parties,
        taxInformationByAccount[row.account] ?? [],
        foreignAmount,
        context
      )
    );
  }

  lines.push('      </Transaction>');
  return lines;
}

function buildLineXml(
  row: RawLedgerRow,
  group: TransactionGroup,
  parties: SaftParty[],
  taxInformation: SaftLineTaxInformation[],
  foreignAmount: SaftForeignAmount | null,
  context: SaftTransactionContext
): string[] {
  const debit = toAmount(row.debit);
  const credit = toAmount(row.credit);

  if (debit <= 0 && credit <= 0) {
    throw new ValidationError(
      t`SAF-T ledger line ${String(row.name)} has no debit or credit amount.`
    );
  }

  const amountXml = buildAmountStructureXml(
    debit > 0 ? 'DebitAmount' : 'CreditAmount',
    debit > 0 ? debit : credit,
    foreignAmount
  );

  const partyXml = getLinePartyXml(row, group, parties);
  const sourceDocumentXml = getLineSourceDocumentXml(
    context,
    partyXml.length > 0
  );
  const taxInformationXml = buildTaxInformationXml(
    row,
    taxInformation
  );

  return [
    '        <Line>',
    `          <RecordID>${escapeXml(String(row.name))}</RecordID>`,
    `          <AccountID>${escapeXml(
      getSaftAccountId(row.account)
    )}</AccountID>`,
    ...sourceDocumentXml,
    ...partyXml,
    `          <Description>${escapeXml(
      `${group.referenceType} ${group.referenceName}`
    )}</Description>`,
    ...amountXml,
    ...taxInformationXml,
    `          <ReferenceNumber>${escapeXml(
      context.referenceNumber
    )}</ReferenceNumber>`,
    '        </Line>',
  ];
}

async function getTransactionContext(
  fyo: Fyo,
  group: TransactionGroup
): Promise<SaftTransactionContext> {
  let isCreditNote = false;
  let correctionReason = '';
  let cancellationReason = '';
  let sourceDocumentId: string | undefined;
  let sourceDocumentOnSubledgerOnly = false;
  let referenceNumber = group.referenceName;
  let extraDescription = '';

  if (
    group.referenceType === 'SalesInvoice' ||
    group.referenceType === 'PurchaseInvoice'
  ) {
    const invoice = (await fyo.doc.getDoc(
      group.referenceType,
      group.referenceName
    )) as Invoice;

    sourceDocumentId = String(invoice.get('returnAgainst') ?? '').trim() || undefined;
    isCreditNote = !!sourceDocumentId;
    correctionReason = String(invoice.get('correctionReason') ?? '').trim();
    cancellationReason = String(
      invoice.get('cancellationReason') ?? ''
    ).trim();

    if (isCreditNote && correctionReason) {
      extraDescription = correctionReason;
    }
  } else if (group.referenceType === 'Payment') {
    const payment = (await fyo.doc.getDoc(
      group.referenceType,
      group.referenceName
    )) as Payment;

    referenceNumber =
      String(payment.get('referenceId') ?? '').trim() || group.referenceName;

    const references = payment.for ?? [];
    if (references.length === 1) {
      sourceDocumentId =
        String(references[0].get('referenceName') ?? '').trim() || undefined;
      sourceDocumentOnSubledgerOnly = true;
    }

    cancellationReason = String(
      payment.get('cancellationReason') ?? ''
    ).trim();
  } else if (group.referenceType === 'JournalEntry') {
    const journalEntry = (await fyo.doc.getDoc(
      group.referenceType,
      group.referenceName
    )) as JournalEntry;

    referenceNumber =
      String(journalEntry.get('referenceNumber') ?? '').trim() ||
      group.referenceName;
    extraDescription = String(
      journalEntry.get('userRemark') ?? ''
    ).trim();
    cancellationReason = String(
      journalEntry.get('cancellationReason') ?? ''
    ).trim();
  }

  const voucher = getVoucherMetadata(
    group.referenceType,
    group.isReversal,
    isCreditNote
  );

  if (group.isReversal && cancellationReason) {
    extraDescription = cancellationReason;
  }

  const description = [
    voucher.description,
    group.referenceName,
    extraDescription,
  ]
    .filter(Boolean)
    .join(': ');

  return {
    voucher,
    description,
    referenceNumber,
    sourceDocumentId,
    sourceDocumentOnSubledgerOnly,
  };
}

function getLineSourceDocumentXml(
  context: SaftTransactionContext,
  isSubledgerLine: boolean
): string[] {
  if (!context.sourceDocumentId) {
    return [];
  }

  if (context.sourceDocumentOnSubledgerOnly && !isSubledgerLine) {
    return [];
  }

  return [
    `          <SourceDocumentID>${escapeXml(
      context.sourceDocumentId
    )}</SourceDocumentID>`,
  ];
}

async function getTransactionForeignAmount(
  fyo: Fyo,
  group: TransactionGroup
): Promise<SaftForeignAmount | null> {
  if (
    group.referenceType !== 'SalesInvoice' &&
    group.referenceType !== 'PurchaseInvoice'
  ) {
    return null;
  }

  const invoice = (await fyo.doc.getDoc(
    group.referenceType,
    group.referenceName
  )) as Invoice;

  const currency = String(invoice.currency ?? '').trim();
  const companyCurrency = String(
    fyo.singles.SystemSettings?.currency ?? 'NOK'
  ).trim();
  const exchangeRate = invoice.exchangeRate ?? 1;

  if (
    !currency ||
    currency === companyCurrency ||
    !Number.isFinite(exchangeRate) ||
    exchangeRate <= 0 ||
    exchangeRate === 1
  ) {
    return null;
  }

  return { currency, exchangeRate };
}

async function getTransactionTaxInformation(
  fyo: Fyo,
  group: TransactionGroup
): Promise<Record<string, SaftLineTaxInformation[]>> {
  if (
    group.referenceType !== 'SalesInvoice' &&
    group.referenceType !== 'PurchaseInvoice'
  ) {
    return {};
  }

  const invoice = (await fyo.doc.getDoc(
    group.referenceType,
    group.referenceName
  )) as Invoice;

  const byAccount: Record<string, Record<string, SaftLineTaxInformation>> = {};

  for (const taxItem of await invoice.getTaxItems()) {
    const account = taxItem.account;
    const taxCode = taxItem.taxCode?.trim();
    const standardTaxCode = taxItem.standardTaxCode?.trim();

    if (!account || !taxCode || !standardTaxCode) {
      throw new ValidationError(
        t`SAF-T VAT information is incomplete for ${group.referenceType} ${group.referenceName}.`
      );
    }

    const exchangeRate = taxItem.exchangeRate ?? 1;
    const taxBase = Math.abs(taxItem.fullAmount.mul(exchangeRate).float);
    const taxAmount = Math.abs(taxItem.taxAmount.mul(exchangeRate).float);
    const key = `${taxCode}:${taxItem.details.rate}`;

    byAccount[account] ??= {};
    const invoiceCurrency = String(invoice.currency ?? '').trim();
    const companyCurrency = String(
      fyo.singles.SystemSettings?.currency ?? 'NOK'
    ).trim();
    const isForeign = invoiceCurrency && invoiceCurrency !== companyCurrency;

    byAccount[account][key] ??= {
      taxCode,
      rate: taxItem.details.rate,
      taxBase: 0,
      taxAmount: 0,
      currency: isForeign ? invoiceCurrency : undefined,
      foreignTaxBase: isForeign ? 0 : undefined,
      foreignTaxAmount: isForeign ? 0 : undefined,
      exchangeRate: isForeign ? exchangeRate : undefined,
    };

    byAccount[account][key].taxBase = roundMoney(
      byAccount[account][key].taxBase + taxBase
    );
    byAccount[account][key].taxAmount = roundMoney(
      byAccount[account][key].taxAmount + taxAmount
    );

    if (isForeign) {
      byAccount[account][key].foreignTaxBase = roundLongMoney(
        (byAccount[account][key].foreignTaxBase ?? 0) +
          Math.abs(taxItem.fullAmount.float)
      );
      byAccount[account][key].foreignTaxAmount = roundLongMoney(
        (byAccount[account][key].foreignTaxAmount ?? 0) +
          Math.abs(taxItem.taxAmount.float)
      );
    }
  }

  return Object.fromEntries(
    Object.entries(byAccount).map(([account, values]) => [
      account,
      Object.values(values),
    ])
  );
}

function buildTaxInformationXml(
  row: RawLedgerRow,
  taxInformation: SaftLineTaxInformation[]
): string[] {
  if (!taxInformation.length) {
    return [];
  }

  const isDebit = toAmount(row.debit) > 0;
  const lines: string[] = [];

  for (const tax of taxInformation) {
    const amountTag = isDebit ? 'DebitTaxAmount' : 'CreditTaxAmount';

    const amountLines = buildTaxAmountStructureXml(amountTag, tax);

    lines.push(
      '          <TaxInformation>',
      '            <TaxType>MVA</TaxType>',
      `            <TaxCode>${escapeXml(tax.taxCode)}</TaxCode>`,
      `            <TaxPercentage>${formatRate(tax.rate)}</TaxPercentage>`,
      '            <Country>NO</Country>',
      `            <TaxBase>${formatMoney(tax.taxBase)}</TaxBase>`,
      '            <TaxBaseDescription>Amount</TaxBaseDescription>',
      ...amountLines
    );

    if (
      tax.currency &&
      tax.exchangeRate &&
      tax.foreignTaxAmount !== undefined
    ) {
      const nokTag = isDebit ? 'DebitNOKTaxAmount' : 'CreditNOKTaxAmount';
      lines.push(
        `            <${nokTag}>`,
        `              <NOKAmount>${formatMoney(tax.taxAmount)}</NOKAmount>`,
        `              <NOKTaxBase>${formatMoney(tax.taxBase)}</NOKTaxBase>`,
        `            </${nokTag}>`
      );
    }

    lines.push('          </TaxInformation>');
  }

  return lines;
}

function buildAmountStructureXml(
  tag: 'DebitAmount' | 'CreditAmount',
  amount: number,
  foreignAmount: SaftForeignAmount | null
): string[] {
  const lines = [
    `          <${tag}>`,
    `            <Amount>${formatMoney(amount)}</Amount>`,
  ];

  if (foreignAmount) {
    lines.push(
      `            <CurrencyCode>${escapeXml(
        foreignAmount.currency
      )}</CurrencyCode>`,
      `            <CurrencyAmount>${formatLongMoney(
        amount / foreignAmount.exchangeRate
      )}</CurrencyAmount>`,
      `            <ExchangeRate>${formatLongMoney(
        foreignAmount.exchangeRate
      )}</ExchangeRate>`
    );
  }

  lines.push(`          </${tag}>`);
  return lines;
}

function buildTaxAmountStructureXml(
  tag: 'DebitTaxAmount' | 'CreditTaxAmount',
  tax: SaftLineTaxInformation
): string[] {
  const lines = [
    `            <${tag}>`,
    `              <Amount>${formatMoney(tax.taxAmount)}</Amount>`,
  ];

  if (
    tax.currency &&
    tax.exchangeRate &&
    tax.foreignTaxAmount !== undefined
  ) {
    lines.push(
      `              <CurrencyCode>${escapeXml(tax.currency)}</CurrencyCode>`,
      `              <CurrencyAmount>${formatLongMoney(
        tax.foreignTaxAmount
      )}</CurrencyAmount>`,
      `              <ExchangeRate>${formatLongMoney(
        tax.exchangeRate
      )}</ExchangeRate>`
    );
  }

  lines.push(`            </${tag}>`);
  return lines;
}

function getLinePartyXml(
  row: RawLedgerRow,
  group: TransactionGroup,
  parties: SaftParty[]
): string[] {
  if (!row.party) {
    return [];
  }

  const party = parties.find(({ name }) => name === row.party);
  if (!party?.defaultAccount || party.defaultAccount !== row.account) {
    return [];
  }

  const id = escapeXml(getSaftPartyId(party));

  if (party.role === 'Customer') {
    return [`          <CustomerID>${id}</CustomerID>`];
  }

  if (party.role === 'Supplier') {
    return [`          <SupplierID>${id}</SupplierID>`];
  }

  if (party.role === 'Both') {
    if (group.referenceType === 'SalesInvoice') {
      return [`          <CustomerID>${id}</CustomerID>`];
    }
    if (group.referenceType === 'PurchaseInvoice') {
      return [`          <SupplierID>${id}</SupplierID>`];
    }
  }

  return [];
}

function groupTransactions(rows: RawLedgerRow[]): TransactionGroup[] {
  const grouped = new Map<string, TransactionGroup>();

  for (const row of rows) {
    const date = normalizeDate(row.date);
    const isReversal = Boolean(row.reverts);
    const referenceType = String(row.referenceType || 'AccountingEntry');
    const referenceName = String(
      row.referenceName || `Ledger-${String(row.name)}`
    );
    const key = [
      referenceType,
      referenceName,
      date,
      isReversal ? 'reversal' : 'original',
    ].join('|');

    let group = grouped.get(key);
    if (!group) {
      group = {
        id: isReversal
          ? `${referenceName}-REV-${date}`
          : referenceName,
        date,
        referenceType,
        referenceName,
        isReversal,
        rows: [],
      };
      grouped.set(key, group);
    }

    group.rows.push(row);
  }

  return [...grouped.values()].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare) {
      return dateCompare;
    }
    return a.id.localeCompare(b.id);
  });
}

function validateBalancedTransactions(groups: TransactionGroup[]) {
  for (const group of groups) {
    const debit = roundMoney(
      group.rows.reduce((sum, row) => sum + toAmount(row.debit), 0)
    );
    const credit = roundMoney(
      group.rows.reduce((sum, row) => sum + toAmount(row.credit), 0)
    );

    if (!moneyEquals(debit, credit)) {
      throw new ValidationError(
        t`SAF-T transaction ${group.id} is not balanced.`
      );
    }
  }
}

export function getSaftAccountId(accountName: string): string {
  const match = accountName.match(/ - (\d{4,})$/);
  return match?.[1] ?? accountName;
}

function getVoucherMetadata(
  referenceType: string,
  isReversal: boolean,
  isCreditNote = false
): { type: string; description: string } {
  const map: Record<string, { type: string; description: string }> = {
    SalesInvoice: isCreditNote
      ? { type: 'SCN', description: 'Sales credit note' }
      : { type: 'SI', description: 'Sales invoice' },
    PurchaseInvoice: isCreditNote
      ? { type: 'PCN', description: 'Purchase credit note' }
      : { type: 'PI', description: 'Purchase invoice' },
    Payment: { type: 'P', description: 'Payment' },
    JournalEntry: { type: 'JE', description: 'Journal entry' },
  };

  const base = map[referenceType] ?? {
    type: 'A',
    description: referenceType || 'Accounting entry',
  };

  if (!isReversal) {
    return base;
  }

  return {
    type: base.type,
    description: `${base.description} reversal`,
  };
}

function normalizeDate(value: string | Date): string {
  if (value instanceof Date) {
    return [
      value.getFullYear().toString().padStart(4, '0'),
      (value.getMonth() + 1).toString().padStart(2, '0'),
      value.getDate().toString().padStart(2, '0'),
    ].join('-');
  }

  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    throw new ValidationError(t`Invalid SAF-T date: ${String(value)}`);
  }
  return match[1];
}

function toAmount(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Math.abs(value);
  }
  if (value == null || value === '') {
    return 0;
  }

  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new ValidationError(t`Invalid SAF-T monetary amount.`);
  }
  return Math.abs(amount);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundLongMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function formatMoney(value: number): string {
  return roundMoney(value).toFixed(2);
}

function formatLongMoney(value: number): string {
  return roundLongMoney(value).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
