import { Fyo, t } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';

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

  const masterFiles = await buildMasterFilesXml(fyo);

  const generalLedgerEntries = buildGeneralLedgerEntriesXml(
    groups,
    totalDebit,
    totalCredit
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

async function buildMasterFilesXml(fyo: Fyo): Promise<string> {
  const parties = (await fyo.db.getAllRaw('Party', {
    fields: [
      'name',
      'role',
      'organizationNumber',
      'defaultAccount',
    ],
    orderBy: 'name',
    order: 'asc',
  })) as unknown as SaftParty[];

  const customers = parties.filter(
    ({ role }) => role === 'Customer' || role === 'Both'
  );
  const suppliers = parties.filter(
    ({ role }) => role === 'Supplier' || role === 'Both'
  );

  const taxes: SaftTax[] = [];
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

    taxes.push({
      name: row.name,
      taxCode,
      standardTaxCode,
      rate: Number(firstDetail.get('rate')),
    });
  }

  const lines = ['  <MasterFiles>'];

  if (customers.length) {
    lines.push('    <Customers>');
    for (const party of customers) {
      lines.push(...buildPartyXml(party, 'Customer'));
    }
    lines.push('    </Customers>');
  }

  if (suppliers.length) {
    lines.push('    <Suppliers>');
    for (const party of suppliers) {
      lines.push(...buildPartyXml(party, 'Supplier'));
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
  kind: 'Customer' | 'Supplier'
): string[] {
  const id = getSaftPartyId(party);
  const accountId = party.defaultAccount
    ? getSaftAccountId(party.defaultAccount)
    : undefined;

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

  if (accountId) {
    lines.push(
      '        <BalanceAccount>',
      `          <AccountID>${escapeXml(accountId)}</AccountID>`,
      '          <OpeningDebitBalance>0.00</OpeningDebitBalance>',
      '          <ClosingDebitBalance>0.00</ClosingDebitBalance>',
      '        </BalanceAccount>'
    );
  }

  lines.push(`      </${kind}>`);
  return lines;
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

function buildGeneralLedgerEntriesXml(
  groups: TransactionGroup[],
  totalDebit: number,
  totalCredit: number
): string {
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
      lines.push(...buildTransactionXml(group));
    }

    lines.push('    </Journal>');
  }

  lines.push('  </GeneralLedgerEntries>');
  return lines.join('\n');
}

function buildTransactionXml(group: TransactionGroup): string[] {
  const date = group.date;
  const period = Number(date.slice(5, 7));
  const year = Number(date.slice(0, 4));
  const voucher = getVoucherMetadata(group.referenceType, group.isReversal);

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
    `        <Description>${escapeXml(
      `${voucher.description} ${group.referenceName}`
    )}</Description>`,
    `        <SystemEntryDate>${date}</SystemEntryDate>`,
    `        <GLPostingDate>${date}</GLPostingDate>`,
  ];

  for (const row of group.rows) {
    lines.push(...buildLineXml(row, group));
  }

  lines.push('      </Transaction>');
  return lines;
}

function buildLineXml(
  row: RawLedgerRow,
  group: TransactionGroup
): string[] {
  const debit = toAmount(row.debit);
  const credit = toAmount(row.credit);

  if (debit <= 0 && credit <= 0) {
    throw new ValidationError(
      t`SAF-T ledger line ${String(row.name)} has no debit or credit amount.`
    );
  }

  const amountXml =
    debit > 0
      ? [
          '          <DebitAmount>',
          `            <Amount>${formatMoney(debit)}</Amount>`,
          '          </DebitAmount>',
        ]
      : [
          '          <CreditAmount>',
          `            <Amount>${formatMoney(credit)}</Amount>`,
          '          </CreditAmount>',
        ];

  return [
    '        <Line>',
    `          <RecordID>${escapeXml(String(row.name))}</RecordID>`,
    `          <AccountID>${escapeXml(
      getSaftAccountId(row.account)
    )}</AccountID>`,
    `          <Description>${escapeXml(
      `${group.referenceType} ${group.referenceName}`
    )}</Description>`,
    ...amountXml,
    `          <ReferenceNumber>${escapeXml(
      group.referenceName
    )}</ReferenceNumber>`,
    '        </Line>',
  ];
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
  isReversal: boolean
): { type: string; description: string } {
  const map: Record<string, { type: string; description: string }> = {
    SalesInvoice: { type: 'SI', description: 'Sales invoice' },
    PurchaseInvoice: { type: 'PI', description: 'Purchase invoice' },
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

function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function formatMoney(value: number): string {
  return roundMoney(value).toFixed(2);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
