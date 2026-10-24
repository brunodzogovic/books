import { ModelNameEnum } from 'models/types';
import {
  findNorwegianBankMultiInvoiceAllocations,
  getNorwegianBankDraftPaymentData,
  getNorwegianBankMultiInvoiceDraftPaymentData,
  getNorwegianBankTransactionFingerprint,
  rankNorwegianBankReconciliationMatches,
  NorwegianBankMatchCandidate,
} from 'regional/noBankReconciliation';
import { NorwegianBankTransaction } from 'regional/noBankStatement';
import test from 'tape';

const candidates: NorwegianBankMatchCandidate[] = [
  {
    schemaName: ModelNameEnum.SalesInvoice,
    invoiceName: 'SINV-1001',
    party: 'Økonomi Kunde AS',
    outstandingAmount: 12500,
  },
  {
    schemaName: ModelNameEnum.SalesInvoice,
    invoiceName: 'SINV-1002',
    party: 'Annen Kunde AS',
    outstandingAmount: 12500,
  },
  {
    schemaName: ModelNameEnum.PurchaseInvoice,
    invoiceName: 'PINV-1001',
    party: 'Hosting Leverandør AS',
    outstandingAmount: 2500,
  },
  {
    schemaName: ModelNameEnum.SalesInvoice,
    invoiceName: 'SINV-CREDIT-1',
    party: 'Refund Kunde AS',
    outstandingAmount: -500,
  },
  {
    schemaName: ModelNameEnum.PurchaseInvoice,
    invoiceName: 'PINV-CREDIT-1',
    party: 'Refund Leverandør AS',
    outstandingAmount: -700,
  },
];

function tx(
  amount: number,
  reference?: string,
  counterpartyName?: string
): NorwegianBankTransaction {
  return {
    bookingDate: '2026-09-20',
    amount,
    currency: 'NOK',
    reference,
    counterpartyName,
  };
}

test('bank reconciliation ranks exact invoice-reference matches first', (t) => {
  const suggestions = rankNorwegianBankReconciliationMatches(
    tx(12500, 'Payment SINV-1001 KID 42', 'Økonomi Kunde AS'),
    candidates
  );

  t.equal(
    suggestions.length,
    2,
    'same-amount sales invoices remain visible for review'
  );
  t.equal(
    suggestions[0].invoiceName,
    'SINV-1001',
    'referenced invoice ranks first'
  );
  t.equal(
    suggestions[0].score,
    110,
    'amount, invoice and party evidence are combined'
  );
  t.equal(
    suggestions[0].confidence,
    'high',
    'strong deterministic evidence is marked high'
  );
  t.equal(suggestions[0].matchKind, 'exact', 'full outstanding match is exact');
  t.deepEqual(
    suggestions[0].reasons,
    [
      'exact outstanding amount',
      'invoice number found in bank reference',
      'counterparty name matches invoice party',
    ],
    'suggestion explains why it ranked first'
  );
  t.equal(
    suggestions[1].confidence,
    'low',
    'amount-only ambiguity stays low confidence'
  );
  t.end();
});

test('bank reconciliation respects customer and supplier cash direction', (t) => {
  const supplierPayment = rankNorwegianBankReconciliationMatches(
    tx(-2500, 'PINV-1001', 'Hosting Leverandør AS'),
    candidates
  );
  t.equal(
    supplierPayment[0]?.invoiceName,
    'PINV-1001',
    'outgoing bank amount matches supplier invoice'
  );

  const wrongDirection = rankNorwegianBankReconciliationMatches(
    tx(2500, 'PINV-1001', 'Hosting Leverandør AS'),
    candidates
  );
  t.equal(
    wrongDirection.some(({ invoiceName }) => invoiceName === 'PINV-1001'),
    false,
    'incoming amount does not match an ordinary supplier payable'
  );
  t.end();
});

test('bank reconciliation handles credit-note refund directions', (t) => {
  const customerRefund = rankNorwegianBankReconciliationMatches(
    tx(-500, 'SINV-CREDIT-1', 'Refund Kunde AS'),
    candidates
  );
  t.equal(
    customerRefund[0]?.invoiceName,
    'SINV-CREDIT-1',
    'outgoing customer refund can match sales credit-note outstanding'
  );

  const supplierRefund = rankNorwegianBankReconciliationMatches(
    tx(700, 'PINV-CREDIT-1', 'Refund Leverandør AS'),
    candidates
  );
  t.equal(
    supplierRefund[0]?.invoiceName,
    'PINV-CREDIT-1',
    'incoming supplier refund can match purchase credit-note outstanding'
  );
  t.end();
});

test('bank reconciliation supports explicit partial invoice matches', (t) => {
  const suggestions = rankNorwegianBankReconciliationMatches(
    tx(5000, 'Part payment SINV-1001', 'Økonomi Kunde AS'),
    candidates
  );

  t.equal(
    suggestions[0]?.invoiceName,
    'SINV-1001',
    'referenced invoice ranks first'
  );
  t.equal(
    suggestions[0]?.matchKind,
    'partial',
    'smaller bank amount is classified as partial'
  );
  t.equal(
    suggestions[0]?.allocationAmount,
    5000,
    'only bank amount is allocated'
  );
  t.equal(
    suggestions[0]?.confidence,
    'medium',
    'reference plus party evidence makes partial match reviewable'
  );
  t.ok(
    suggestions[0]?.reasons.includes('partial amount within outstanding balance'),
    'partial evidence is explicit'
  );
  t.end();
});

test('bank reconciliation refuses overpayments instead of guessing', (t) => {
  const suggestions = rankNorwegianBankReconciliationMatches(
    tx(12500.01, 'SINV-1001', 'Økonomi Kunde AS'),
    candidates
  );
  t.equal(
    suggestions.some(({ invoiceName }) => invoiceName === 'SINV-1001'),
    false,
    'bank amount above outstanding is not auto-matched'
  );
  t.end();
});

test('reviewed bank match creates safe draft payment values', (t) => {
  const transaction = tx(
    12500,
    'Payment SINV-1001 KID 42',
    'Økonomi Kunde AS'
  );
  const suggestion = rankNorwegianBankReconciliationMatches(
    transaction,
    candidates
  )[0];
  const draft = getNorwegianBankDraftPaymentData(
    transaction,
    suggestion,
    'Bank - Operating'
  );

  t.equal(
    draft.party,
    'Økonomi Kunde AS',
    'party comes from reviewed invoice match'
  );
  t.equal(
    draft.paymentType,
    'Receive',
    'incoming bank amount becomes a receipt'
  );
  t.equal(
    draft.paymentMethod,
    'Bank - Operating',
    'explicit bank payment method is preserved'
  );
  t.equal(draft.amount, 12500, 'draft payment amount is positive');
  t.equal(draft.for[0].referenceName, 'SINV-1001', 'matched invoice is linked');
  t.equal(draft.for[0].amount, 12500, 'allocation uses the bank amount');
  t.equal(
    draft.referenceId,
    'Payment SINV-1001 KID 42',
    'bank reference is preserved'
  );
  t.ok(
    draft.norwegianBankTransactionFingerprint.startsWith('no-bank-v1-'),
    'draft carries durable duplicate-detection fingerprint'
  );
  t.equal(
    draft.date.toISOString(),
    '2026-09-20T00:00:00.000Z',
    'booking date becomes the draft posting date'
  );
  t.end();
});

test('draft payment direction follows bank cash flow for credit notes', (t) => {
  const customerRefundTransaction = tx(
    -500,
    'SINV-CREDIT-1',
    'Refund Kunde AS'
  );
  const customerRefund = rankNorwegianBankReconciliationMatches(
    customerRefundTransaction,
    candidates
  )[0];
  const customerDraft = getNorwegianBankDraftPaymentData(
    customerRefundTransaction,
    customerRefund,
    'Bank - Operating'
  );
  t.equal(
    customerDraft.paymentType,
    'Pay',
    'customer refund creates outgoing payment'
  );
  t.equal(
    customerDraft.amount,
    500,
    'customer refund draft amount stays positive'
  );

  const supplierRefundTransaction = tx(
    700,
    'PINV-CREDIT-1',
    'Refund Leverandør AS'
  );
  const supplierRefund = rankNorwegianBankReconciliationMatches(
    supplierRefundTransaction,
    candidates
  )[0];
  const supplierDraft = getNorwegianBankDraftPaymentData(
    supplierRefundTransaction,
    supplierRefund,
    'Bank - Operating'
  );
  t.equal(
    supplierDraft.paymentType,
    'Receive',
    'supplier refund creates incoming receipt'
  );
  t.equal(
    supplierDraft.amount,
    700,
    'supplier refund draft amount stays positive'
  );
  t.end();
});

test('bank reconciliation finds exact same-party multi-invoice allocations', (t) => {
  const multiCandidates: NorwegianBankMatchCandidate[] = [
    {
      schemaName: ModelNameEnum.SalesInvoice,
      invoiceName: 'SINV-2001',
      party: 'Samlet Kunde AS',
      outstandingAmount: 3000,
    },
    {
      schemaName: ModelNameEnum.SalesInvoice,
      invoiceName: 'SINV-2002',
      party: 'Samlet Kunde AS',
      outstandingAmount: 4500,
    },
    {
      schemaName: ModelNameEnum.SalesInvoice,
      invoiceName: 'SINV-OTHER',
      party: 'Annen Kunde AS',
      outstandingAmount: 4500,
    },
  ];
  const transaction = tx(
    7500,
    'SINV-2001 SINV-2002',
    'Samlet Kunde AS'
  );

  const allocations = findNorwegianBankMultiInvoiceAllocations(
    transaction,
    multiCandidates
  );

  t.equal(allocations.length, 1, 'one same-party exact combination is found');
  t.deepEqual(
    allocations[0].allocations.map(({ invoiceName }) => invoiceName).sort(),
    ['SINV-2001', 'SINV-2002'],
    'allocation links both invoices'
  );
  t.equal(
    allocations[0].allocations.reduce((sum, row) => sum + row.amount, 0),
    7500,
    'allocation total equals bank transaction'
  );

  const draft = getNorwegianBankMultiInvoiceDraftPaymentData(
    transaction,
    allocations[0],
    'Bank - Operating'
  );
  t.equal(draft.amount, 7500, 'multi-invoice draft keeps bank amount');
  t.equal(draft.for.length, 2, 'multi-invoice draft carries two references');
  t.end();
});

test('multi-invoice allocation never mixes parties', (t) => {
  const mixed: NorwegianBankMatchCandidate[] = [
    {
      schemaName: ModelNameEnum.SalesInvoice,
      invoiceName: 'SINV-A',
      party: 'Kunde A AS',
      outstandingAmount: 3000,
    },
    {
      schemaName: ModelNameEnum.SalesInvoice,
      invoiceName: 'SINV-B',
      party: 'Kunde B AS',
      outstandingAmount: 4500,
    },
  ];

  t.equal(
    findNorwegianBankMultiInvoiceAllocations(tx(7500), mixed).length,
    0,
    'different parties are not combined into one Payment'
  );
  t.end();
});

test('bank transaction fingerprint is stable and identity-sensitive', (t) => {
  const first: NorwegianBankTransaction = {
    bookingDate: '2026-09-20',
    amount: 12500,
    currency: 'nok',
    reference: ' Faktura 42 ',
    description: 'Betaling',
    counterpartyName: 'Økonomi Kunde AS',
    counterpartyAccount: 'NO12 3456 7890 1',
  };
  const normalized: NorwegianBankTransaction = {
    ...first,
    currency: 'NOK',
    reference: 'faktura 42',
    counterpartyName: 'økonomi kunde as',
    counterpartyAccount: 'NO12345678901',
  };
  const changed = { ...normalized, amount: 12500.01 };

  t.equal(
    getNorwegianBankTransactionFingerprint(first),
    getNorwegianBankTransactionFingerprint(normalized),
    'normalization differences do not change fingerprint'
  );
  t.notEqual(
    getNorwegianBankTransactionFingerprint(normalized),
    getNorwegianBankTransactionFingerprint(changed),
    'material transaction change changes fingerprint'
  );
  t.end();
});
