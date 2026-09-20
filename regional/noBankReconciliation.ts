import { Fyo } from 'fyo';
import { ModelNameEnum } from 'models/types';
import { NorwegianBankTransaction } from './noBankStatement';

export type NorwegianBankMatchConfidence = 'high' | 'medium' | 'low';

export type NorwegianBankMatchCandidate = {
  schemaName:
    | ModelNameEnum.SalesInvoice
    | ModelNameEnum.PurchaseInvoice;
  invoiceName: string;
  party: string;
  outstandingAmount: number;
};

export type NorwegianBankMatchSuggestion = NorwegianBankMatchCandidate & {
  score: number;
  confidence: NorwegianBankMatchConfidence;
  reasons: string[];
};

type RawOpenInvoice = {
  name: string;
  party: string;
  outstandingAmount: string | number | null;
};

export async function getNorwegianBankReconciliationSuggestions(
  fyo: Fyo,
  transaction: NorwegianBankTransaction
): Promise<NorwegianBankMatchSuggestion[]> {
  const companyCurrency = String(
    fyo.singles.SystemSettings?.currency ?? 'NOK'
  ).toUpperCase();

  if (transaction.currency.toUpperCase() !== companyCurrency) {
    return [];
  }

  const candidates: NorwegianBankMatchCandidate[] = [];
  for (const schemaName of [
    ModelNameEnum.SalesInvoice,
    ModelNameEnum.PurchaseInvoice,
  ] as const) {
    const invoices = (await fyo.db.getAllRaw(schemaName, {
      fields: ['name', 'party', 'outstandingAmount'],
      filters: {
        submitted: true,
        cancelled: false,
      },
    })) as RawOpenInvoice[];

    for (const invoice of invoices) {
      const outstandingAmount = Number(invoice.outstandingAmount ?? 0);
      if (!Number.isFinite(outstandingAmount) || Math.abs(outstandingAmount) < 0.005) {
        continue;
      }

      candidates.push({
        schemaName,
        invoiceName: invoice.name,
        party: invoice.party,
        outstandingAmount,
      });
    }
  }

  return rankNorwegianBankReconciliationMatches(transaction, candidates);
}

export function rankNorwegianBankReconciliationMatches(
  transaction: NorwegianBankTransaction,
  candidates: NorwegianBankMatchCandidate[]
): NorwegianBankMatchSuggestion[] {
  const searchText = normalizeSearchText(
    [transaction.reference, transaction.description].filter(Boolean).join(' ')
  );
  const counterparty = normalizeSearchText(transaction.counterpartyName ?? '');
  const bankAmount = transaction.amount;

  const suggestions: NorwegianBankMatchSuggestion[] = [];

  for (const candidate of candidates) {
    if (!hasCompatibleDirection(bankAmount, candidate)) {
      continue;
    }

    const reasons: string[] = [];
    let score = 0;

    if (amountsEqual(Math.abs(bankAmount), Math.abs(candidate.outstandingAmount))) {
      score += 60;
      reasons.push('exact outstanding amount');
    } else {
      continue;
    }

    const invoiceToken = normalizeSearchText(candidate.invoiceName);
    if (invoiceToken && searchText.includes(invoiceToken)) {
      score += 30;
      reasons.push('invoice number found in bank reference');
    }

    const party = normalizeSearchText(candidate.party);
    if (counterparty && party && counterparty === party) {
      score += 20;
      reasons.push('counterparty name matches invoice party');
    }

    suggestions.push({
      ...candidate,
      score,
      confidence: getConfidence(score),
      reasons,
    });
  }

  return suggestions.sort(
    (a, b) =>
      b.score - a.score ||
      a.schemaName.localeCompare(b.schemaName) ||
      a.invoiceName.localeCompare(b.invoiceName)
  );
}

function hasCompatibleDirection(
  bankAmount: number,
  candidate: NorwegianBankMatchCandidate
): boolean {
  if (bankAmount === 0 || candidate.outstandingAmount === 0) {
    return false;
  }

  const bankIncoming = bankAmount > 0;
  const outstandingPositive = candidate.outstandingAmount > 0;

  if (candidate.schemaName === ModelNameEnum.SalesInvoice) {
    return bankIncoming === outstandingPositive;
  }

  return bankIncoming !== outstandingPositive;
}

function amountsEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('nb-NO')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getConfidence(score: number): NorwegianBankMatchConfidence {
  if (score >= 90) {
    return 'high';
  }

  if (score >= 75) {
    return 'medium';
  }

  return 'low';
}
