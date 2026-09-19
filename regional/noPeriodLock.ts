import { Fyo, t } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';

type PeriodLockDoc = {
  fyo: Fyo;
  date?: Date | string | null;
};

function toDateOnly(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

export function validateNorwegianAccountingPeriod(doc: PeriodLockDoc): void {
  if (doc.fyo.singles.SystemSettings?.countryCode !== 'no') {
    return;
  }

  const lockValue = doc.fyo.singles.AccountingSettings?.get(
    'accountingLockDate'
  ) as Date | string | null | undefined;

  if (!lockValue || !doc.date) {
    return;
  }

  const lockDate = toDateOnly(lockValue);
  const postingDate = toDateOnly(doc.date);

  if (postingDate > lockDate) {
    return;
  }

  throw new ValidationError(
    t`Accounting is locked through ${lockDate}. Transactions dated ${postingDate} cannot be posted or reversed in that period.`
  );
}
