import { Fyo } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';
import { ModelNameEnum } from 'models/types';
import { NorwegianBankTransaction } from './noBankStatement';

export type NorwegianBankMatchConfidence = 'high' | 'medium' | 'low';
export type NorwegianBankMatchKind = 'exact' | 'partial';

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
  matchKind: NorwegianBankMatchKind;
  allocationAmount: number;
};

export type NorwegianBankAllocation = NorwegianBankMatchCandidate & {
  amount: number;
};

export type NorwegianBankAllocationSuggestion = {
  schemaName:
    | ModelNameEnum.SalesInvoice
    | ModelNameEnum.PurchaseInvoice;
  party: string;
  allocations: NorwegianBankAllocation[];
  score: number;
  confidence: NorwegianBankMatchConfidence;
  reasons: string[];
};

type RawOpenInvoice = {
  name: string;
  party: string;
  outstandingAmount: string | number | null;
};

export async function getNorwegianBankReconciliationCandidates(
  fyo: Fyo
): Promise<NorwegianBankMatchCandidate[]> {
  const candidates: NorwegianBankMatchCandidate[] = [];
  const companyCurrency = String(
    fyo.singles.SystemSettings?.currency ?? 'NOK'
  ).toUpperCase();

  for (const schemaName of [
    ModelNameEnum.SalesInvoice,
    ModelNameEnum.PurchaseInvoice,
  ] as const) {
    const invoices = (await fyo.db.getAllRaw(schemaName, {
      fields: ['name', 'party', 'outstandingAmount', 'currency'],
      filters: {
        submitted: true,
        cancelled: false,
      },
    })) as (RawOpenInvoice & { currency?: string | null })[];

    for (const invoice of invoices) {
      const invoiceCurrency = String(
        invoice.currency ?? companyCurrency
      ).toUpperCase();
      if (invoiceCurrency !== companyCurrency) {
        continue;
      }

      const outstandingAmount = Number(invoice.outstandingAmount ?? 0);
      if (
        !Number.isFinite(outstandingAmount) ||
        Math.abs(outstandingAmount) < 0.005
      ) {
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

  return candidates;
}

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

  const candidates = await getNorwegianBankReconciliationCandidates(fyo);
  return rankNorwegianBankReconciliationMatches(transaction, candidates);
}

export function getNorwegianBankDraftPaymentData(
  transaction: NorwegianBankTransaction,
  suggestion: NorwegianBankMatchSuggestion,
  paymentMethod: string
) {
  return getDraftPaymentData(
    transaction,
    paymentMethod,
    suggestion.party,
    [
      {
        referenceType: suggestion.schemaName,
        referenceName: suggestion.invoiceName,
        amount: suggestion.allocationAmount,
      },
    ]
  );
}

export function getNorwegianBankMultiInvoiceDraftPaymentData(
  transaction: NorwegianBankTransaction,
  suggestion: NorwegianBankAllocationSuggestion,
  paymentMethod: string
) {
  if (suggestion.allocations.length < 2) {
    throw new ValidationError(
      'A multi-invoice bank allocation must contain at least two invoices.'
    );
  }

  const amount = Math.abs(transaction.amount);
  const allocationTotal = suggestion.allocations.reduce(
    (sum, allocation) => sum + allocation.amount,
    0
  );

  if (!amountsEqual(amount, allocationTotal)) {
    throw new ValidationError(
      'Bank allocation total must equal the bank transaction amount.'
    );
  }

  for (const allocation of suggestion.allocations) {
    if (
      allocation.party !== suggestion.party ||
      allocation.schemaName !== suggestion.schemaName ||
      !hasCompatibleDirection(transaction.amount, allocation) ||
      allocation.amount <= 0 ||
      allocation.amount - Math.abs(allocation.outstandingAmount) >= 0.005
    ) {
      throw new ValidationError('Bank allocation contains incompatible invoices.');
    }
  }

  return getDraftPaymentData(
    transaction,
    paymentMethod,
    suggestion.party,
    suggestion.allocations.map((allocation) => ({
      referenceType: allocation.schemaName,
      referenceName: allocation.invoiceName,
      amount: allocation.amount,
    }))
  );
}

function getDraftPaymentData(
  transaction: NorwegianBankTransaction,
  paymentMethod: string,
  party: string,
  allocations: {
    referenceType:
      | ModelNameEnum.SalesInvoice
      | ModelNameEnum.PurchaseInvoice;
    referenceName: string;
    amount: number;
  }[]
) {
  const postingDate = new Date(
    `${transaction.bookingDate}T00:00:00.000Z`
  );
  const amount = Math.abs(transaction.amount);
  const referenceId =
    transaction.reference?.trim() ||
    transaction.description?.trim() ||
    undefined;

  return {
    party,
    date: postingDate,
    paymentType: transaction.amount > 0 ? ('Receive' as const) : ('Pay' as const),
    paymentMethod,
    clearanceDate: postingDate,
    referenceDate: postingDate,
    referenceId,
    amount,
    norwegianBankTransactionFingerprint:
      getNorwegianBankTransactionFingerprint(transaction),
    for: allocations,
  };
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
  const bankAmountAbs = Math.abs(bankAmount);

  const suggestions: NorwegianBankMatchSuggestion[] = [];

  for (const candidate of candidates) {
    if (!hasCompatibleDirection(bankAmount, candidate)) {
      continue;
    }

    const reasons: string[] = [];
    let score = 0;
    let matchKind: NorwegianBankMatchKind;

    const outstandingAbs = Math.abs(candidate.outstandingAmount);
    if (amountsEqual(bankAmountAbs, outstandingAbs)) {
      score += 60;
      matchKind = 'exact';
      reasons.push('exact outstanding amount');
    } else if (bankAmountAbs < outstandingAbs - 0.005) {
      score += 35;
      matchKind = 'partial';
      reasons.push('partial amount within outstanding balance');
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
      matchKind,
      allocationAmount: bankAmountAbs,
    });
  }

  return suggestions.sort(
    (a, b) =>
      b.score - a.score ||
      (a.matchKind === b.matchKind
        ? 0
        : a.matchKind === 'exact'
        ? -1
        : 1) ||
      a.schemaName.localeCompare(b.schemaName) ||
      a.invoiceName.localeCompare(b.invoiceName)
  );
}

export function findNorwegianBankMultiInvoiceAllocations(
  transaction: NorwegianBankTransaction,
  candidates: NorwegianBankMatchCandidate[],
  maxResults = 8
): NorwegianBankAllocationSuggestion[] {
  const target = toMinorUnits(transaction.amount);
  if (target <= 0) {
    return [];
  }

  const searchText = normalizeSearchText(
    [transaction.reference, transaction.description].filter(Boolean).join(' ')
  );
  const counterparty = normalizeSearchText(transaction.counterpartyName ?? '');
  const grouped = new Map<string, NorwegianBankMatchCandidate[]>();

  for (const candidate of candidates) {
    if (!hasCompatibleDirection(transaction.amount, candidate)) {
      continue;
    }

    const amount = toMinorUnits(candidate.outstandingAmount);
    if (amount <= 0 || amount >= target) {
      continue;
    }

    const key = `${candidate.schemaName}\u0000${candidate.party}`;
    const list = grouped.get(key) ?? [];
    list.push(candidate);
    grouped.set(key, list);
  }

  const results: NorwegianBankAllocationSuggestion[] = [];
  const seen = new Set<string>();

  for (const group of grouped.values()) {
    const sorted = [...group]
      .sort((a, b) => {
        const aReferenced = searchText.includes(
          normalizeSearchText(a.invoiceName)
        )
          ? 1
          : 0;
        const bReferenced = searchText.includes(
          normalizeSearchText(b.invoiceName)
        )
          ? 1
          : 0;
        return (
          bReferenced - aReferenced ||
          Math.abs(b.outstandingAmount) - Math.abs(a.outstandingAmount) ||
          a.invoiceName.localeCompare(b.invoiceName)
        );
      })
      .slice(0, 14);

    const walk = (
      start: number,
      selected: NorwegianBankMatchCandidate[],
      total: number
    ) => {
      if (results.length >= maxResults) {
        return;
      }

      if (total === target && selected.length >= 2) {
        const names = selected.map(({ invoiceName }) => invoiceName).sort();
        const key = `${selected[0].schemaName}|${selected[0].party}|${names.join('|')}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);

        const partyMatches =
          counterparty &&
          normalizeSearchText(selected[0].party) === counterparty;
        const hasReferencedInvoice = selected.some(({ invoiceName }) =>
          searchText.includes(normalizeSearchText(invoiceName))
        );

        let score = 60;
        const reasons = ['exact multi-invoice amount'];
        if (hasReferencedInvoice) {
          score += 30;
          reasons.push('invoice numbers found in bank reference');
        }
        if (partyMatches) {
          score += 20;
          reasons.push('counterparty name matches invoice party');
        }

        results.push({
          schemaName: selected[0].schemaName,
          party: selected[0].party,
          allocations: selected.map((candidate) => ({
            ...candidate,
            amount: Math.abs(candidate.outstandingAmount),
          })),
          score,
          confidence: getConfidence(score),
          reasons,
        });
        return;
      }

      if (total >= target || selected.length >= 4) {
        return;
      }

      for (let index = start; index < sorted.length; index += 1) {
        const candidate = sorted[index];
        const amount = toMinorUnits(candidate.outstandingAmount);
        if (total + amount > target) {
          continue;
        }

        selected.push(candidate);
        walk(index + 1, selected, total + amount);
        selected.pop();

        if (results.length >= maxResults) {
          return;
        }
      }
    };

    walk(0, [], 0);

    if (results.length >= maxResults) {
      break;
    }
  }

  return results.sort(
    (a, b) =>
      b.score - a.score ||
      a.allocations.length - b.allocations.length ||
      a.allocations[0].invoiceName.localeCompare(b.allocations[0].invoiceName)
  );
}

export function getNorwegianBankTransactionFingerprint(
  transaction: NorwegianBankTransaction
): string {
  const canonical = [
    transaction.bookingDate,
    Math.round(transaction.amount * 100).toString(),
    transaction.currency.trim().toUpperCase(),
    normalizeFingerprintText(transaction.reference ?? ''),
    normalizeFingerprintText(transaction.description ?? ''),
    normalizeFingerprintText(transaction.counterpartyName ?? ''),
    normalizeFingerprintText(transaction.counterpartyAccount ?? ''),
  ].join('|');

  const parts = [
    hash32(canonical, 0x811c9dc5),
    hash32(canonical, 0x9e3779b1),
    hash32(canonical, 0x85ebca6b),
  ];

  return `no-bank-v1-${parts
    .map((part) => part.toString(16).padStart(8, '0'))
    .join('')}`;
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

function toMinorUnits(value: number): number {
  return Math.abs(Math.round(value * 100));
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('nb-NO')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeFingerprintText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, ' ');
}

function getConfidence(score: number): NorwegianBankMatchConfidence {
  if (score >= 90) {
    return 'high';
  }

  if (score >= 65) {
    return 'medium';
  }

  return 'low';
}

function hash32(value: string, seed: number): number {
  let hash = seed >>> 0;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= hash >>> 13;
  }

  return hash >>> 0;
}
