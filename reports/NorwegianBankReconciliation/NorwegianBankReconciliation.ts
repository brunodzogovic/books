import { t } from 'fyo';
import { Action } from 'fyo/model/types';
import { ValidationError } from 'fyo/utils/errors';
import { ModelNameEnum } from 'models/types';
import getCommonExportActions from 'reports/commonExporter';
import { Report } from 'reports/Report';
import { ColumnField, ReportRow } from 'reports/types';
import { Field, SelectOption } from 'schemas/types';
import { handleErrorWithDialog } from 'src/errorHandling';
import { getFormRoute, routeTo } from 'src/utils/ui';
import {
  getNorwegianBankDraftPaymentData,
  getNorwegianBankReconciliationCandidates,
  NorwegianBankMatchConfidence,
  NorwegianBankMatchSuggestion,
  rankNorwegianBankReconciliationMatches,
} from 'regional/noBankReconciliation';
import {
  getNorwegianBankStatementCsvHeaders,
  NorwegianBankCsvMapping,
  NorwegianBankTransaction,
  parseNorwegianBankStatementCsv,
} from 'regional/noBankStatement';

type NorwegianBankReviewRow = {
  bookingDate: Date;
  amount: number;
  currency: string;
  counterparty: string;
  details: string;
  suggestedDocument: string;
  party: string;
  candidateCount: number;
  confidence: NorwegianBankMatchConfidence | 'manual';
  evidence: string;
  nextStep: string;
};

type BankPaymentMethodOption = {
  name: string;
  account?: string | null;
};

const HEADER_ALIASES = {
  bookingDate: ['bokføringsdato', 'bokforingsdato', 'booking date', 'date', 'dato'],
  amount: ['beløp', 'belop', 'amount'],
  currency: ['valuta', 'currency'],
  reference: ['referanse', 'reference', 'kid'],
  description: ['beskrivelse', 'description', 'tekst'],
  counterpartyName: ['motpart', 'counterparty', 'navn'],
  counterpartyAccount: [
    'motpartskonto',
    'counterparty account',
    'kontonummer',
  ],
} as const;

export class NorwegianBankReconciliation extends Report {
  static title = t`Bank Reconciliation`;
  static reportName = 'norwegian-bank-reconciliation';

  loading = false;
  sourceCsv = '';
  sourceFileName = '';
  headers: string[] = [];

  bookingDateColumn?: string;
  amountColumn?: string;
  currencyColumn?: string;
  referenceColumn?: string;
  descriptionColumn?: string;
  counterpartyNameColumn?: string;
  counterpartyAccountColumn?: string;
  defaultCurrency = 'NOK';
  bankPaymentMethod?: string;
  bankPaymentMethods: BankPaymentMethodOption[] = [];

  async setDefaultFilters() {
    this.defaultCurrency ||= String(
      this.fyo.singles.SystemSettings?.currency ?? 'NOK'
    ).toUpperCase();

    const methods = (await this.fyo.db.getAllRaw(ModelNameEnum.PaymentMethod, {
      fields: ['name', 'account'],
      filters: { type: 'Bank' },
    })) as BankPaymentMethodOption[];

    this.bankPaymentMethods = methods
      .filter(({ name }) => typeof name === 'string' && name.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const selectedIsValid = this.bankPaymentMethods.some(
      ({ name }) => name === this.bankPaymentMethod
    );
    if (!selectedIsValid) {
      this.bankPaymentMethod =
        this.bankPaymentMethods.length === 1
          ? this.bankPaymentMethods[0].name
          : undefined;
    }
  }

  getActions(): Action[] {
    if (this.fyo.singles.SystemSettings?.countryCode !== 'no') {
      return [];
    }

    return [
      {
        group: t`Bank`,
        label: t`Load Bank CSV`,
        type: 'primary',
        action: async () => {
          await this.loadBankCsv();
        },
      },
      ...getCommonExportActions(this),
    ];
  }

  getFilters(): Field[] {
    if (!this.headers.length) {
      return [];
    }

    const requiredOptions = this.getColumnOptions(t`Select column`);
    const optionalOptions = this.getColumnOptions(t`Not mapped`);

    return [
      {
        fieldname: 'sourceFileName',
        fieldtype: 'Data',
        label: t`Source File`,
        readOnly: true,
      },
      {
        fieldname: 'bankPaymentMethod',
        fieldtype: 'Select',
        label: t`Bank Payment Method`,
        options: this.getBankPaymentMethodOptions(),
      },
      {
        fieldname: 'bookingDateColumn',
        fieldtype: 'Select',
        label: t`Booking Date Column`,
        options: requiredOptions,
        required: true,
      },
      {
        fieldname: 'amountColumn',
        fieldtype: 'Select',
        label: t`Amount Column`,
        options: requiredOptions,
        required: true,
      },
      {
        fieldname: 'currencyColumn',
        fieldtype: 'Select',
        label: t`Currency Column`,
        options: optionalOptions,
      },
      {
        fieldname: 'referenceColumn',
        fieldtype: 'Select',
        label: t`Reference Column`,
        options: optionalOptions,
      },
      {
        fieldname: 'descriptionColumn',
        fieldtype: 'Select',
        label: t`Description Column`,
        options: optionalOptions,
      },
      {
        fieldname: 'counterpartyNameColumn',
        fieldtype: 'Select',
        label: t`Counterparty Name Column`,
        options: optionalOptions,
      },
      {
        fieldname: 'counterpartyAccountColumn',
        fieldtype: 'Select',
        label: t`Counterparty Account Column`,
        options: optionalOptions,
      },
      {
        fieldname: 'defaultCurrency',
        fieldtype: 'Data',
        label: t`Default Currency`,
        required: true,
      },
    ];
  }

  getColumns(): ColumnField[] {
    return [
      { fieldname: 'bookingDate', fieldtype: 'Date', label: t`Booking Date`, width: 1 },
      { fieldname: 'amount', fieldtype: 'Float', label: t`Amount`, align: 'right', width: 1 },
      { fieldname: 'currency', fieldtype: 'Data', label: t`Currency`, width: 0.7 },
      { fieldname: 'counterparty', fieldtype: 'Data', label: t`Counterparty`, width: 1.5 },
      { fieldname: 'details', fieldtype: 'Data', label: t`Reference / Description`, width: 2 },
      { fieldname: 'suggestedDocument', fieldtype: 'Data', label: t`Suggested Document`, width: 1.5 },
      { fieldname: 'party', fieldtype: 'Data', label: t`Party`, width: 1.3 },
      { fieldname: 'candidateCount', fieldtype: 'Int', label: t`Candidates`, align: 'right', width: 0.7 },
      { fieldname: 'confidence', fieldtype: 'Data', label: t`Confidence`, width: 0.9 },
      { fieldname: 'evidence', fieldtype: 'Data', label: t`Evidence`, width: 2.2 },
      { fieldname: 'nextStep', fieldtype: 'Data', label: t`Next Step`, width: 1.4 },
    ];
  }

  async setReportData(): Promise<void> {
    this.loading = true;
    try {
      if (!this.sourceCsv || !this.bookingDateColumn || !this.amountColumn) {
        this.reportData = [];
        return;
      }

      const transactions = parseNorwegianBankStatementCsv(
        this.sourceCsv,
        this.getMapping(),
        { defaultCurrency: this.defaultCurrency }
      );
      const candidates = await getNorwegianBankReconciliationCandidates(this.fyo);
      const companyCurrency = String(
        this.fyo.singles.SystemSettings?.currency ?? 'NOK'
      ).toUpperCase();

      this.reportData = transactions.map((transaction) => {
        const suggestions =
          transaction.currency.toUpperCase() === companyCurrency
            ? rankNorwegianBankReconciliationMatches(transaction, candidates)
            : [];
        return this.getReportRow(
          this.getReviewRow(transaction, suggestions),
          transaction,
          suggestions
        );
      });
    } finally {
      this.loading = false;
    }
  }

  private async loadBankCsv(): Promise<void> {
    const selected = await ipc.selectFile({
      title: t`Select Bank Statement CSV`,
      filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    });

    if (selected.canceled || !selected.success) {
      return;
    }

    const text = new TextDecoder('utf-8').decode(Uint8Array.from(selected.data));
    const headers = getNorwegianBankStatementCsvHeaders(text);
    if (!headers.length) {
      throw new ValidationError(t`Bank statement CSV has no header row.`);
    }

    this.sourceCsv = text;
    this.sourceFileName = selected.name;
    this.headers = headers;
    this.inferColumnMappings();
    await this.updateData(undefined, true);
  }

  private getColumnOptions(emptyLabel: string): SelectOption[] {
    return [
      { label: emptyLabel, value: '' },
      ...this.headers.map((header) => ({
        label: header || t`Unnamed column`,
        value: header,
      })),
    ];
  }

  private getBankPaymentMethodOptions(): SelectOption[] {
    return [
      { label: t`Select bank payment method`, value: '' },
      ...this.bankPaymentMethods.map(({ name, account }) => ({
        label: account ? `${name} · ${account}` : name,
        value: name,
      })),
    ];
  }

  private getMapping(): NorwegianBankCsvMapping {
    const mapping: NorwegianBankCsvMapping = {
      bookingDate: this.bookingDateColumn!,
      amount: this.amountColumn!,
    };

    if (this.currencyColumn) mapping.currency = this.currencyColumn;
    if (this.referenceColumn) mapping.reference = this.referenceColumn;
    if (this.descriptionColumn) mapping.description = this.descriptionColumn;
    if (this.counterpartyNameColumn) {
      mapping.counterpartyName = this.counterpartyNameColumn;
    }
    if (this.counterpartyAccountColumn) {
      mapping.counterpartyAccount = this.counterpartyAccountColumn;
    }

    return mapping;
  }

  private inferColumnMappings(): void {
    this.bookingDateColumn = inferHeader(this.headers, HEADER_ALIASES.bookingDate);
    this.amountColumn = inferHeader(this.headers, HEADER_ALIASES.amount);
    this.currencyColumn = inferHeader(this.headers, HEADER_ALIASES.currency);
    this.referenceColumn = inferHeader(this.headers, HEADER_ALIASES.reference);
    this.descriptionColumn = inferHeader(this.headers, HEADER_ALIASES.description);
    this.counterpartyNameColumn = inferHeader(
      this.headers,
      HEADER_ALIASES.counterpartyName
    );
    this.counterpartyAccountColumn = inferHeader(
      this.headers,
      HEADER_ALIASES.counterpartyAccount
    );
  }

  private getReviewRow(
    transaction: NorwegianBankTransaction,
    suggestions: NorwegianBankMatchSuggestion[]
  ): NorwegianBankReviewRow {
    const top = suggestions[0];
    return {
      bookingDate: new Date(`${transaction.bookingDate}T00:00:00.000Z`),
      amount: transaction.amount,
      currency: transaction.currency,
      counterparty: [
        transaction.counterpartyName,
        transaction.counterpartyAccount,
      ]
        .filter(Boolean)
        .join(' · '),
      details: [transaction.reference, transaction.description]
        .filter(Boolean)
        .join(' · '),
      suggestedDocument: top
        ? `${this.fyo.schemaMap[top.schemaName]?.label ?? top.schemaName} ${top.invoiceName}`
        : '',
      party: top?.party ?? '',
      candidateCount: suggestions.length,
      confidence: top?.confidence ?? 'manual',
      evidence: top
        ? top.reasons.map(translateEvidence).join(', ')
        : t`No exact invoice match; review manually.`,
      nextStep: !top
        ? t`Manual review`
        : this.canCreateDraftPayment(suggestions)
        ? t`Create draft payment`
        : t`Resolve ambiguity`,
    };
  }

  private getReportRow(
    row: NorwegianBankReviewRow,
    transaction: NorwegianBankTransaction,
    suggestions: NorwegianBankMatchSuggestion[]
  ): ReportRow {
    const reportRow: ReportRow = {
      cells: [
        { rawValue: row.bookingDate, value: this.fyo.format(row.bookingDate, 'Date'), width: 1 },
        { rawValue: row.amount, value: this.fyo.format(row.amount, 'Float'), align: 'right', width: 1 },
        { rawValue: row.currency, value: row.currency, width: 0.7 },
        { rawValue: row.counterparty, value: row.counterparty, width: 1.5 },
        { rawValue: row.details, value: row.details, width: 2 },
        { rawValue: row.suggestedDocument, value: row.suggestedDocument, width: 1.5 },
        { rawValue: row.party, value: row.party, width: 1.3 },
        { rawValue: row.candidateCount, value: String(row.candidateCount), align: 'right', width: 0.7 },
        { rawValue: row.confidence, value: translateConfidence(row.confidence), width: 0.9 },
        { rawValue: row.evidence, value: row.evidence, width: 2.2 },
        { rawValue: row.nextStep, value: row.nextStep, width: 1.4 },
      ],
    };

    if (this.canCreateDraftPayment(suggestions)) {
      reportRow.onClick = async () => {
        await this.openDraftPayment(transaction, suggestions[0]);
      };
    }

    return reportRow;
  }

  private canCreateDraftPayment(
    suggestions: NorwegianBankMatchSuggestion[]
  ): boolean {
    const top = suggestions[0];
    if (!top) {
      return false;
    }

    return suggestions.length === 1 || top.confidence !== 'low';
  }

  private async openDraftPayment(
    transaction: NorwegianBankTransaction,
    suggestion: NorwegianBankMatchSuggestion
  ): Promise<void> {
    try {
      if (!this.bankPaymentMethod) {
        throw new ValidationError(
          t`Select a bank payment method before creating a draft payment.`
        );
      }

      const paymentMethod = await this.fyo.doc.getDoc(
        ModelNameEnum.PaymentMethod,
        this.bankPaymentMethod
      );
      if (paymentMethod.get('type') !== 'Bank') {
        throw new ValidationError(
          t`Selected bank payment method must be a Bank payment method.`
        );
      }
      const bankAccount = paymentMethod.get('account');
      if (typeof bankAccount !== 'string' || !bankAccount) {
        throw new ValidationError(
          t`Selected bank payment method must have a bank account configured.`
        );
      }

      const bankAccountDoc = await this.fyo.doc.getDoc(
        ModelNameEnum.Account,
        bankAccount
      );
      if (bankAccountDoc.get('accountType') !== 'Bank') {
        throw new ValidationError(
          t`Selected bank payment method account must be a Bank account.`
        );
      }

      const data = getNorwegianBankDraftPaymentData(
        transaction,
        suggestion,
        this.bankPaymentMethod
      );
      const payment = this.fyo.doc.getNewDoc(ModelNameEnum.Payment, data);
      await payment.runFormulas();

      const route = getFormRoute(ModelNameEnum.Payment, payment.name!);
      await routeTo(route);
    } catch (error) {
      await handleErrorWithDialog(error, undefined, false, true);
    }
  }
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('nb-NO')
    .trim();
}

function inferHeader(
  headers: string[],
  aliases: readonly string[]
): string | undefined {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const matches = normalizedHeaders
      .map((header, index) => (header === normalizedAlias ? index : -1))
      .filter((index) => index !== -1);
    if (matches.length === 1) {
      return headers[matches[0]];
    }
  }
  return undefined;
}

function translateConfidence(
  confidence: NorwegianBankMatchConfidence | 'manual'
): string {
  if (confidence === 'high') return t`High`;
  if (confidence === 'medium') return t`Medium`;
  if (confidence === 'low') return t`Low`;
  return t`Manual review`;
}

function translateEvidence(reason: string): string {
  if (reason === 'exact outstanding amount') return t`Exact outstanding amount`;
  if (reason === 'invoice number found in bank reference') {
    return t`Invoice number found in bank reference`;
  }
  if (reason === 'counterparty name matches invoice party') {
    return t`Counterparty name matches invoice party`;
  }
  return reason;
}
