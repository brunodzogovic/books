import { ModelNameEnum } from 'models/types';
import {
  getNorwegianBankDraftPaymentData,
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

  t.equal(suggestions.length, 2, 'same-amount sales invoices remain visible for review');
  t.equal(suggestions[0].invoiceName, 'SINV-1001', 'referenced invoice ranks first');
  t.equal(suggestions[0].score, 110, 'amount, invoice and party evidence are combined');
  t.equal(suggestions[0].confidence, 'high', 'strong deterministic evidence is marked high');
  t.deepEqual(
    suggestions[0].reasons,
    [
      'exact outstanding amount',
      'invoice number found in bank reference',
      'counterparty name matches invoice party',
    ],
    'suggestion explains why it ranked first'
  );
  t.equal(suggestions[1].confidence, 'low', 'amount-only ambiguity stays low confidence');
  t.end();
});

test('bank reconciliation respects customer and supplier cash direction', (t) => {
  const supplierPayment = rankNorwegianBankReconciliationMatches(
    tx(-2500, 'PINV-1001', 'Hosting Leverandør AS'),
    candidates
  );
  t.equal(supplierPayment[0]?.invoiceName, 'PINV-1001', 'outgoing bank amount matches supplier invoice');

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

test('bank reconciliation refuses near amounts instead of auto-guessing', (t) => {
  const suggestions = rankNorwegianBankReconciliationMatches(
    tx(12499.99, 'SINV-1001', 'Økonomi Kunde AS'),
    candidates
  );
  t.equal(suggestions.length, 0, 'non-exact amount is left unmatched for manual review');
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

  t.equal(draft.party, 'Økonomi Kunde AS', 'party comes from reviewed invoice match');
  t.equal(draft.paymentType, 'Receive', 'incoming bank amount becomes a receipt');
  t.equal(draft.paymentMethod, 'Bank - Operating', 'explicit bank payment method is preserved');
  t.equal(draft.amount, 12500, 'draft payment amount is positive');
  t.equal(draft.for[0].referenceName, 'SINV-1001', 'matched invoice is linked');
  t.equal(draft.for[0].amount, 12500, 'allocation uses the bank amount');
  t.equal(draft.referenceId, 'Payment SINV-1001 KID 42', 'bank reference is preserved');
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
  t.equal(customerDraft.paymentType, 'Pay', 'customer refund creates outgoing payment');
  t.equal(customerDraft.amount, 500, 'customer refund draft amount stays positive');

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
  t.equal(supplierDraft.paymentType, 'Receive', 'supplier refund creates incoming receipt');
  t.equal(supplierDraft.amount, 700, 'supplier refund draft amount stays positive');
  t.end();
});
