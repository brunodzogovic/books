import { t } from 'fyo';
import { Action } from 'fyo/model/types';
import { ValidationError } from 'fyo/utils/errors';
import { ModelNameEnum } from 'models/types';
import getCommonExportActions from 'reports/commonExporter';
import { Report } from 'reports/Report';
import { ColumnField, ReportRow } from 'reports/types';
import { Field, SelectOption } from 'schemas/types';
import { handleErrorWithDialog } from 'src/errorHandling';
import { showDialog } from 'src/utils/interactive';
import { DialogButton } from 'src/utils/types';
import { getFormRoute, routeTo } from 'src/utils/ui';
import {
  findNorwegianBankMultiInvoiceAllocations,
  getNorwegianBankDraftPaymentData,
  getNorwegianBankMultiInvoiceDraftPaymentData,
  getNorwegianBankReconciliationCandidates,
  getNorwegianBankTransactionFingerprint,
  NorwegianBankAllocationSuggestion,
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

type NorwegianBankReviewStatus =
  | 'ready'
  | 'partial'
  | 'ambiguous'
  | 'manual'
  | 'processed';

type NorwegianBankReviewRow = {
  bookingDate: Date;
  amount: number;
  currency: string;
  counterparty: string;
  details: string;
  status: NorwegianBankReviewStatus;
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

type BankImportProfile = {
  name: string;
  headerSignature: string;
  mapping: NorwegianBankCsvMapping;
  defaultCurrency: string;
  bankPaymentMethod?: string;
};

type ExistingBankPayment = {
  name: string;
  cancelled?: boolean | null;
  norwegianBankTransactionFingerprint?: string | null;
};

type ReviewOption =
  | {
      kind: 'single';
      score: number;
      confidence: NorwegianBankMatchConfidence;
      suggestion: NorwegianBankMatchSuggestion;
    }
  | {
      kind: 'multi';
      score: number;
      confidence: NorwegianBankMatchConfidence;
      suggestion: NorwegianBankAllocationSuggestion;
    };

const HEADER_ALIASES = {
  bookingDate: [
    'bokføringsdato',
    'bokforingsdato',
    'booking date',
    'date',
    'dato',
  ],
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

  mappingProfile?: string;
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
  bankImportProfiles: BankImportProfile[] = [];

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

    this.bankImportProfiles = parseBankImportProfiles(
      this.fyo.singles.AccountingSettings?.get('bankImportProfiles')
    );

    if (
      this.mappingProfile &&
      !this.bankImportProfiles.some(({ name }) => name === this.mappingProfile)
    ) {
      this.mappingProfile = undefined;
    }

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
      {
        group: t`Bank`,
        label: t`Save Mapping Profile`,
        action: async () => {
          await this.saveMappingProfile();
        },
      },
      {
        group: t`Bank`,
        label: t`Delete Mapping Profile`,
        action: async () => {
          await this.deleteMappingProfile();
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
        fieldname: 'mappingProfile',
        fieldtype: 'Select',
        label: t`Mapping Profile`,
        options: this.getMappingProfileOptions(),
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
      {
        fieldname: 'bookingDate',
        fieldtype: 'Date',
        label: t`Booking Date`,
        width: 1,
      },
      {
        fieldname: 'amount',
        fieldtype: 'Float',
        label: t`Amount`,
        align: 'right',
        width: 1,
      },
      {
        fieldname: 'currency',
        fieldtype: 'Data',
        label: t`Currency`,
        width: 0.7,
      },
      {
        fieldname: 'counterparty',
        fieldtype: 'Data',
        label: t`Counterparty`,
        width: 1.5,
      },
      {
        fieldname: 'details',
        fieldtype: 'Data',
        label: t`Reference / Description`,
        width: 2,
      },
      {
        fieldname: 'status',
        fieldtype: 'Data',
        label: t`Status`,
        width: 0.9,
      },
      {
        fieldname: 'suggestedDocument',
        fieldtype: 'Data',
        label: t`Suggested Document`,
        width: 1.7,
      },
      {
        fieldname: 'party',
        fieldtype: 'Data',
        label: t`Party`,
        width: 1.3,
      },
      {
        fieldname: 'candidateCount',
        fieldtype: 'Int',
        label: t`Candidates`,
        align: 'right',
        width: 0.7,
      },
      {
        fieldname: 'confidence',
        fieldtype: 'Data',
        label: t`Confidence`,
        width: 0.9,
      },
      {
        fieldname: 'evidence',
        fieldtype: 'Data',
        label: t`Evidence`,
        width: 2.2,
      },
      {
        fieldname: 'nextStep',
        fieldtype: 'Data',
        label: t`Next Step`,
        width: 1.5,
      },
    ];
  }

  async setReportData(filter?: string): Promise<void> {
    this.loading = true;
    try {
      if (filter === 'mappingProfile' && this.mappingProfile) {
        this.applyMappingProfile(this.mappingProfile);
      }

      if (!this.sourceCsv || !this.bookingDateColumn || !this.amountColumn) {
        this.reportData = [];
        return;
      }

      const transactions = parseNorwegianBankStatementCsv(
        this.sourceCsv,
        this.getMapping(),
        { defaultCurrency: this.defaultCurrency }
      );
      const candidates = await getNorwegianBankReconciliationCandidates(
        this.fyo
      );
      const processed = await this.getProcessedBankTransactions();
      const companyCurrency = String(
        this.fyo.singles.SystemSettings?.currency ?? 'NOK'
      ).toUpperCase();
      const partialEnabled = Boolean(
        this.fyo.singles.AccountingSettings?.get('enablePartialPayment')
      );

      this.reportData = transactions.map((transaction) => {
        const fingerprint =
          getNorwegianBankTransactionFingerprint(transaction);
        const processedPayment = processed.get(fingerprint);

        const singleSuggestions =
          transaction.currency.toUpperCase() === companyCurrency
            ? rankNorwegianBankReconciliationMatches(
                transaction,
                candidates
              )
            : [];
        const multiSuggestions =
          transaction.currency.toUpperCase() === companyCurrency
            ? findNorwegianBankMultiInvoiceAllocations(
                transaction,
                candidates
              )
            : [];

        const options = this.getReviewOptions(
          singleSuggestions,
          multiSuggestions
        );

        return this.getReportRow(
          this.getReviewRow(
            transaction,
            options,
            processedPayment,
            partialEnabled
          ),
          transaction,
          options,
          processedPayment,
          partialEnabled
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

    const text = new TextDecoder('utf-8').decode(
      Uint8Array.from(selected.data)
    );
    const headers = getNorwegianBankStatementCsvHeaders(text);
    if (!headers.length) {
      throw new ValidationError(t`Bank statement CSV has no header row.`);
    }

    this.sourceCsv = text;
    this.sourceFileName = selected.name;
    this.headers = headers;
    this.inferColumnMappings();
    this.autoApplyMappingProfile();
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

  private getMappingProfileOptions(): SelectOption[] {
    return [
      { label: t`No saved profile`, value: '' },
      ...this.bankImportProfiles.map(({ name }) => ({
        label: name,
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
    this.bookingDateColumn = inferHeader(
      this.headers,
      HEADER_ALIASES.bookingDate
    );
    this.amountColumn = inferHeader(this.headers, HEADER_ALIASES.amount);
    this.currencyColumn = inferHeader(
      this.headers,
      HEADER_ALIASES.currency
    );
    this.referenceColumn = inferHeader(
      this.headers,
      HEADER_ALIASES.reference
    );
    this.descriptionColumn = inferHeader(
      this.headers,
      HEADER_ALIASES.description
    );
    this.counterpartyNameColumn = inferHeader(
      this.headers,
      HEADER_ALIASES.counterpartyName
    );
    this.counterpartyAccountColumn = inferHeader(
      this.headers,
      HEADER_ALIASES.counterpartyAccount
    );
  }

  private getReviewOptions(
    singleSuggestions: NorwegianBankMatchSuggestion[],
    multiSuggestions: NorwegianBankAllocationSuggestion[]
  ): ReviewOption[] {
    return [
      ...singleSuggestions.map(
        (suggestion) =>
          ({
            kind: 'single',
            score: suggestion.score,
            confidence: suggestion.confidence,
            suggestion,
          } as ReviewOption)
      ),
      ...multiSuggestions.map(
        (suggestion) =>
          ({
            kind: 'multi',
            score: suggestion.score,
            confidence: suggestion.confidence,
            suggestion,
          } as ReviewOption)
      ),
    ].sort(
      (a, b) =>
        b.score - a.score ||
        (a.kind === b.kind ? 0 : a.kind === 'single' ? -1 : 1)
    );
  }

  private isAmbiguous(options: ReviewOption[]): boolean {
    if (options.length <= 1) {
      return false;
    }

    return options[0].score - options[1].score < 25;
  }

  private getReviewRow(
    transaction: NorwegianBankTransaction,
    options: ReviewOption[],
    processedPayment: string | undefined,
    partialEnabled: boolean
  ): NorwegianBankReviewRow {
    const bookingDate = new Date(
      `${transaction.bookingDate}T00:00:00.000Z`
    );
    const top = options[0];
    const ambiguous = this.isAmbiguous(options);

    if (processedPayment) {
      return {
        bookingDate,
        amount: transaction.amount,
        currency: transaction.currency,
        counterparty: this.getCounterparty(transaction),
        details: this.getTransactionDetails(transaction),
        status: 'processed',
        suggestedDocument: processedPayment,
        party: '',
        candidateCount: options.length,
        confidence: 'manual',
        evidence: t`Bank transaction fingerprint already exists on a payment.`,
        nextStep: t`Already processed`,
      };
    }

    if (!top) {
      return {
        bookingDate,
        amount: transaction.amount,
        currency: transaction.currency,
        counterparty: this.getCounterparty(transaction),
        details: this.getTransactionDetails(transaction),
        status: 'manual',
        suggestedDocument: '',
        party: '',
        candidateCount: 0,
        confidence: 'manual',
        evidence: t`No safe invoice match; review manually.`,
        nextStep: t`Manual review`,
      };
    }

    const isPartial =
      top.kind === 'single' &&
      top.suggestion.matchKind === 'partial';
    const status: NorwegianBankReviewStatus = ambiguous
      ? 'ambiguous'
      : isPartial
      ? 'partial'
      : 'ready';

    const suggestedDocument =
      top.kind === 'single'
        ? `${
            this.fyo.schemaMap[top.suggestion.schemaName]?.label ??
            top.suggestion.schemaName
          } ${top.suggestion.invoiceName}`
        : top.suggestion.allocations
            .map(({ invoiceName }) => invoiceName)
            .join(' + ');

    let nextStep: string;
    if (ambiguous) {
      nextStep = t`Choose match`;
    } else if (isPartial && !partialEnabled) {
      nextStep = t`Enable partial payments`;
    } else if (top.kind === 'multi') {
      nextStep = t`Create multi-invoice draft`;
    } else if (isPartial) {
      nextStep = t`Create partial draft payment`;
    } else {
      nextStep = t`Create draft payment`;
    }

    return {
      bookingDate,
      amount: transaction.amount,
      currency: transaction.currency,
      counterparty: this.getCounterparty(transaction),
      details: this.getTransactionDetails(transaction),
      status,
      suggestedDocument,
      party: top.suggestion.party,
      candidateCount: options.length,
      confidence: top.confidence,
      evidence: top.suggestion.reasons
        .map(translateEvidence)
        .join(', '),
      nextStep,
    };
  }

  private getReportRow(
    row: NorwegianBankReviewRow,
    transaction: NorwegianBankTransaction,
    options: ReviewOption[],
    processedPayment: string | undefined,
    partialEnabled: boolean
  ): ReportRow {
    const reportRow: ReportRow = {
      cells: [
        {
          rawValue: row.bookingDate,
          value: this.fyo.format(row.bookingDate, 'Date'),
          width: 1,
        },
        {
          rawValue: row.amount,
          value: this.fyo.format(row.amount, 'Float'),
          align: 'right',
          width: 1,
        },
        { rawValue: row.currency, value: row.currency, width: 0.7 },
        {
          rawValue: row.counterparty,
          value: row.counterparty,
          width: 1.5,
        },
        { rawValue: row.details, value: row.details, width: 2 },
        {
          rawValue: row.status,
          value: translateStatus(row.status),
          width: 0.9,
        },
        {
          rawValue: row.suggestedDocument,
          value: row.suggestedDocument,
          width: 1.7,
        },
        { rawValue: row.party, value: row.party, width: 1.3 },
        {
          rawValue: row.candidateCount,
          value: String(row.candidateCount),
          align: 'right',
          width: 0.7,
        },
        {
          rawValue: row.confidence,
          value: translateConfidence(row.confidence),
          width: 0.9,
        },
        { rawValue: row.evidence, value: row.evidence, width: 2.2 },
        {
          rawValue: row.nextStep,
          value: row.nextStep,
          width: 1.5,
        },
      ],
    };

    if (processedPayment || !options.length) {
      return reportRow;
    }

    const top = options[0];
    const topIsBlockedPartial =
      top.kind === 'single' &&
      top.suggestion.matchKind === 'partial' &&
      !partialEnabled;

    if (topIsBlockedPartial && !this.isAmbiguous(options)) {
      return reportRow;
    }

    reportRow.onClick = async () => {
      if (this.isAmbiguous(options)) {
        await this.resolveAmbiguity(
          transaction,
          options,
          partialEnabled
        );
        return;
      }

      await this.openReviewOption(
        transaction,
        top,
        partialEnabled
      );
    };

    return reportRow;
  }

  private async resolveAmbiguity(
    transaction: NorwegianBankTransaction,
    options: ReviewOption[],
    partialEnabled: boolean
  ): Promise<void> {
    try {
      const topOptions = options.slice(0, 3);
      const details = [
        t`Select the reviewed allocation to use for this bank transaction.`,
        ...topOptions.map((option) =>
          this.describeOption(option)
        ),
      ];

      const buttons: DialogButton[] = topOptions.map(
        (option) => ({
          label: this.optionButtonLabel(option),
          action: async () => {
            await this.openReviewOption(
              transaction,
              option,
              partialEnabled
            );
          },
        })
      );

      buttons.push({
        label: t`Cancel`,
        action: () => undefined,
        isEscape: true,
      });

      await showDialog({
        title: t`Resolve Bank Match`,
        detail: details,
        buttons,
      });
    } catch (error) {
      await handleErrorWithDialog(
        error,
        undefined,
        false,
        true
      );
    }
  }

  private describeOption(option: ReviewOption): string {
    if (option.kind === 'single') {
      const {
        invoiceName,
        party,
        allocationAmount,
        matchKind,
      } = option.suggestion;
      return `${invoiceName} · ${party} · ${this.fyo.format(
        allocationAmount,
        'Float'
      )} · ${translateMatchKind(
        matchKind
      )} · ${translateConfidence(option.confidence)}`;
    }

    const names = option.suggestion.allocations
      .map(({ invoiceName }) => invoiceName)
      .join(' + ');
    return `${names} · ${option.suggestion.party} · ${translateConfidence(
      option.confidence
    )}`;
  }

  private optionButtonLabel(option: ReviewOption): string {
    if (option.kind === 'single') {
      return option.suggestion.invoiceName;
    }

    const names = option.suggestion.allocations.map(
      ({ invoiceName }) => invoiceName
    );
    const compact = names.join(' + ');
    return compact.length <= 36
      ? compact
      : `${names.slice(0, 2).join(' + ')} + …`;
  }

  private async openReviewOption(
    transaction: NorwegianBankTransaction,
    option: ReviewOption,
    partialEnabled: boolean
  ): Promise<void> {
    if (
      option.kind === 'single' &&
      option.suggestion.matchKind === 'partial' &&
      !partialEnabled
    ) {
      throw new ValidationError(
        t`Enable partial payments before creating a partial bank payment.`
      );
    }

    if (option.kind === 'single') {
      await this.openDraftPayment(
        transaction,
        option.suggestion
      );
      return;
    }

    await this.openMultiDraftPayment(
      transaction,
      option.suggestion
    );
  }

  private async openDraftPayment(
    transaction: NorwegianBankTransaction,
    suggestion: NorwegianBankMatchSuggestion
  ): Promise<void> {
    try {
      const paymentMethod =
        await this.validateBankPaymentMethod();
      const data = getNorwegianBankDraftPaymentData(
        transaction,
        suggestion,
        paymentMethod
      );
      const payment = this.fyo.doc.getNewDoc(
        ModelNameEnum.Payment,
        data
      );
      await payment.runFormulas();

      const route = getFormRoute(
        ModelNameEnum.Payment,
        payment.name!
      );
      await routeTo(route);
    } catch (error) {
      await handleErrorWithDialog(
        error,
        undefined,
        false,
        true
      );
    }
  }

  private async openMultiDraftPayment(
    transaction: NorwegianBankTransaction,
    suggestion: NorwegianBankAllocationSuggestion
  ): Promise<void> {
    try {
      const paymentMethod =
        await this.validateBankPaymentMethod();
      const data = getNorwegianBankMultiInvoiceDraftPaymentData(
        transaction,
        suggestion,
        paymentMethod
      );
      const payment = this.fyo.doc.getNewDoc(
        ModelNameEnum.Payment,
        data
      );
      await payment.runFormulas();

      const route = getFormRoute(
        ModelNameEnum.Payment,
        payment.name!
      );
      await routeTo(route);
    } catch (error) {
      await handleErrorWithDialog(
        error,
        undefined,
        false,
        true
      );
    }
  }

  private async validateBankPaymentMethod(): Promise<string> {
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

    return this.bankPaymentMethod;
  }

  private async getProcessedBankTransactions(): Promise<
    Map<string, string>
  > {
    const rows = (await this.fyo.db.getAllRaw(
      ModelNameEnum.Payment,
      {
        fields: [
          'name',
          'cancelled',
          'norwegianBankTransactionFingerprint',
        ],
      }
    )) as ExistingBankPayment[];

    return rows.reduce((map, row) => {
      const fingerprint =
        row.norwegianBankTransactionFingerprint;
      if (
        !row.cancelled &&
        typeof fingerprint === 'string' &&
        fingerprint.length
      ) {
        map.set(fingerprint, row.name);
      }
      return map;
    }, new Map<string, string>());
  }

  private getCounterparty(
    transaction: NorwegianBankTransaction
  ): string {
    return [
      transaction.counterpartyName,
      transaction.counterpartyAccount,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  private getTransactionDetails(
    transaction: NorwegianBankTransaction
  ): string {
    return [
      transaction.reference,
      transaction.description,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  private autoApplyMappingProfile(): void {
    const signature = getHeaderSignature(this.headers);
    const matches = this.bankImportProfiles.filter(
      ({ headerSignature }) =>
        headerSignature === signature
    );

    if (matches.length !== 1) {
      this.mappingProfile = undefined;
      return;
    }

    this.mappingProfile = matches[0].name;
    this.applyMappingProfile(matches[0].name);
  }

  private applyMappingProfile(name: string): void {
    const profile = this.bankImportProfiles.find(
      (candidate) => candidate.name === name
    );
    if (!profile) {
      return;
    }

    const hasHeader = (header?: string) =>
      !header || this.headers.includes(header);

    const mapping = profile.mapping;
    this.bookingDateColumn = hasHeader(
      mapping.bookingDate
    )
      ? mapping.bookingDate
      : undefined;
    this.amountColumn = hasHeader(mapping.amount)
      ? mapping.amount
      : undefined;
    this.currencyColumn = hasHeader(mapping.currency)
      ? mapping.currency
      : undefined;
    this.referenceColumn = hasHeader(mapping.reference)
      ? mapping.reference
      : undefined;
    this.descriptionColumn = hasHeader(
      mapping.description
    )
      ? mapping.description
      : undefined;
    this.counterpartyNameColumn = hasHeader(
      mapping.counterpartyName
    )
      ? mapping.counterpartyName
      : undefined;
    this.counterpartyAccountColumn = hasHeader(
      mapping.counterpartyAccount
    )
      ? mapping.counterpartyAccount
      : undefined;
    this.defaultCurrency =
      profile.defaultCurrency || this.defaultCurrency;

    if (
      profile.bankPaymentMethod &&
      this.bankPaymentMethods.some(
        ({ name: paymentMethod }) =>
          paymentMethod === profile.bankPaymentMethod
      )
    ) {
      this.bankPaymentMethod =
        profile.bankPaymentMethod;
    }
  }

  private async saveMappingProfile(): Promise<void> {
    try {
      if (
        !this.headers.length ||
        !this.bookingDateColumn ||
        !this.amountColumn
      ) {
        throw new ValidationError(
          t`Load a bank CSV and map the required columns before saving a profile.`
        );
      }

      const rawName = (await showDialog({
        title: t`Save Bank Mapping Profile`,
        detail: t`Save the current CSV column mapping and bank payment method for reuse.`,
        input: {
          label: t`Profile Name`,
          placeholder: t`For example: DNB operating account`,
          value: this.mappingProfile ?? '',
          required: true,
        },
        buttons: [
          {
            label: t`Save`,
            isPrimary: true,
            action: (value?: string) =>
              value?.trim() ?? '',
          },
          {
            label: t`Cancel`,
            isEscape: true,
            action: () => '',
          },
        ],
      })) as string;

      const name = rawName.trim();
      if (!name) {
        return;
      }

      const profile: BankImportProfile = {
        name,
        headerSignature: getHeaderSignature(
          this.headers
        ),
        mapping: this.getMapping(),
        defaultCurrency: this.defaultCurrency,
        bankPaymentMethod: this.bankPaymentMethod,
      };

      const profiles = this.bankImportProfiles.filter(
        (candidate) => candidate.name !== name
      );
      profiles.push(profile);
      profiles.sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      await this.persistBankImportProfiles(profiles);
      this.bankImportProfiles = profiles;
      this.mappingProfile = name;
      await this.updateData(undefined, true);
    } catch (error) {
      await handleErrorWithDialog(
        error,
        undefined,
        false,
        true
      );
    }
  }

  private async deleteMappingProfile(): Promise<void> {
    try {
      if (!this.mappingProfile) {
        throw new ValidationError(
          t`Select a saved mapping profile to delete.`
        );
      }

      const confirmed = (await showDialog({
        title: t`Delete Bank Mapping Profile`,
        detail: t`Delete saved mapping profile ${this.mappingProfile}?`,
        buttons: [
          {
            label: t`Delete`,
            isPrimary: true,
            action: () => true,
          },
          {
            label: t`Cancel`,
            isEscape: true,
            action: () => false,
          },
        ],
      })) as boolean;

      if (!confirmed) {
        return;
      }

      const profiles =
        this.bankImportProfiles.filter(
          ({ name }) =>
            name !== this.mappingProfile
        );
      await this.persistBankImportProfiles(profiles);
      this.bankImportProfiles = profiles;
      this.mappingProfile = undefined;
      await this.updateData(undefined, true);
    } catch (error) {
      await handleErrorWithDialog(
        error,
        undefined,
        false,
        true
      );
    }
  }

  private async persistBankImportProfiles(
    profiles: BankImportProfile[]
  ): Promise<void> {
    const settings =
      this.fyo.singles.AccountingSettings;
    if (!settings) {
      throw new ValidationError(
        t`Accounting settings are not available.`
      );
    }

    await settings.setAndSync(
      'bankImportProfiles',
      JSON.stringify(profiles)
    );
  }
}

function parseBankImportProfiles(
  value: unknown
): BankImportProfile[] {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (profile): profile is BankImportProfile =>
          typeof profile === 'object' &&
          profile !== null &&
          typeof (profile as BankImportProfile)
            .name === 'string' &&
          typeof (profile as BankImportProfile)
            .headerSignature === 'string' &&
          typeof (profile as BankImportProfile)
            .mapping === 'object' &&
          typeof (profile as BankImportProfile)
            .defaultCurrency === 'string'
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name)
      );
  } catch {
    return [];
  }
}

function getHeaderSignature(
  headers: string[]
): string {
  return headers.map(normalizeHeader).join('|');
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
  const normalizedHeaders =
    headers.map(normalizeHeader);
  for (const alias of aliases) {
    const normalizedAlias =
      normalizeHeader(alias);
    const matches = normalizedHeaders
      .map((header, index) =>
        header === normalizedAlias ? index : -1
      )
      .filter((index) => index !== -1);
    if (matches.length === 1) {
      return headers[matches[0]];
    }
  }
  return undefined;
}

function translateConfidence(
  confidence:
    | NorwegianBankMatchConfidence
    | 'manual'
): string {
  if (confidence === 'high') return t`High`;
  if (confidence === 'medium') return t`Medium`;
  if (confidence === 'low') return t`Low`;
  return t`Manual review`;
}

function translateStatus(
  status: NorwegianBankReviewStatus
): string {
  if (status === 'ready') return t`Ready`;
  if (status === 'partial') return t`Partial`;
  if (status === 'ambiguous') return t`Ambiguous`;
  if (status === 'processed') return t`Processed`;
  return t`Manual review`;
}

function translateMatchKind(
  kind: 'exact' | 'partial'
): string {
  return kind === 'exact'
    ? t`Exact`
    : t`Partial`;
}

function translateEvidence(reason: string): string {
  if (reason === 'exact outstanding amount') {
    return t`Exact outstanding amount`;
  }
  if (
    reason ===
    'partial amount within outstanding balance'
  ) {
    return t`Partial amount within outstanding balance`;
  }
  if (reason === 'exact multi-invoice amount') {
    return t`Exact multi-invoice amount`;
  }
  if (
    reason ===
    'invoice number found in bank reference'
  ) {
    return t`Invoice number found in bank reference`;
  }
  if (
    reason ===
    'invoice numbers found in bank reference'
  ) {
    return t`Invoice numbers found in bank reference`;
  }
  if (
    reason ===
    'counterparty name matches invoice party'
  ) {
    return t`Counterparty name matches invoice party`;
  }
  return reason;
}
