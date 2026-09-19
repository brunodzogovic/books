import { Fyo, t } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';
import { Doc } from 'fyo/model/doc';

export type NorwegianVatSnapshotDetail = {
  account: string;
  payment_account?: string;
  rate: number;
};

export type NorwegianVatSnapshot = {
  taxCode: string;
  standardTaxCode: string;
  details: NorwegianVatSnapshotDetail[];
};

export function parseNorwegianVatSnapshot(
  value: unknown
): NorwegianVatSnapshot | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<NorwegianVatSnapshot>;
    if (
      typeof parsed.taxCode !== 'string' ||
      !parsed.taxCode ||
      typeof parsed.standardTaxCode !== 'string' ||
      !parsed.standardTaxCode ||
      !Array.isArray(parsed.details)
    ) {
      return null;
    }

    const details = parsed.details.filter(
      (detail): detail is NorwegianVatSnapshotDetail =>
        !!detail &&
        typeof detail.account === 'string' &&
        !!detail.account &&
        typeof detail.rate === 'number'
    );

    if (!details.length) {
      return null;
    }

    return {
      taxCode: parsed.taxCode,
      standardTaxCode: parsed.standardTaxCode,
      details,
    };
  } catch {
    return null;
  }
}

export async function buildNorwegianVatSnapshot(
  fyo: Fyo,
  taxName: string
): Promise<NorwegianVatSnapshot> {
  const tax = await fyo.doc.getDoc('Tax', taxName);
  const taxCode = (tax?.get('taxCode') as string | undefined)?.trim() ?? '';
  const standardTaxCode =
    (tax?.get('standardTaxCode') as string | undefined)?.trim() ?? '';

  if (!taxCode || !standardTaxCode) {
    throw new ValidationError(
      t`Norwegian VAT mapping is required for tax template ${taxName}.`
    );
  }

  const details = ((tax?.get('details') as Doc[] | undefined) ?? [])
    .map((detail) => ({
      account: detail.get('account') as string,
      payment_account: detail.get('payment_account') as string | undefined,
      rate: detail.get('rate') as number,
    }))
    .filter(
      (detail) =>
        typeof detail.account === 'string' &&
        !!detail.account &&
        typeof detail.rate === 'number'
    );

  if (!details.length) {
    throw new ValidationError(
      t`Norwegian VAT tax template ${taxName} has no valid tax details.`
    );
  }

  return { taxCode, standardTaxCode, details };
}
