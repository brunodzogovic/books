import { ValidationError } from 'fyo/utils/errors';

export type NorwegianBankCsvMapping = {
  bookingDate: string;
  amount: string;
  currency?: string;
  reference?: string;
  description?: string;
  counterpartyName?: string;
  counterpartyAccount?: string;
};

export type NorwegianBankCsvOptions = {
  delimiter?: ',' | ';' | '\t' | 'auto';
  defaultCurrency?: string;
};

export type NorwegianBankTransaction = {
  bookingDate: string;
  amount: number;
  currency: string;
  reference?: string;
  description?: string;
  counterpartyName?: string;
  counterpartyAccount?: string;
};

export function parseNorwegianBankStatementCsv(
  text: string,
  mapping: NorwegianBankCsvMapping,
  options: NorwegianBankCsvOptions = {}
): NorwegianBankTransaction[] {
  const normalized = text.replace(/^\uFEFF/, '').trim();
  if (!normalized) {
    return [];
  }

  const delimiter =
    options.delimiter && options.delimiter !== 'auto'
      ? options.delimiter
      : detectDelimiter(normalized);

  const rows = parseDelimitedRows(normalized, delimiter);
  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const index = getColumnIndices(headers, mapping);
  const defaultCurrency = (options.defaultCurrency ?? 'NOK').trim().toUpperCase();

  return rows
    .slice(1)
    .filter((row) => row.some((value) => value.trim() !== ''))
    .map((row, rowOffset) => {
      const rowNumber = rowOffset + 2;
      const bookingDate = parseBankDate(
        getMappedValue(row, index.bookingDate),
        rowNumber
      );
      const amount = parseBankAmount(
        getMappedValue(row, index.amount),
        rowNumber
      );
      const currency =
        cleanOptional(getMappedValue(row, index.currency))?.toUpperCase() ??
        defaultCurrency;

      if (!currency) {
        throw new ValidationError(
          `Bank statement row ${rowNumber} has no currency and no default currency.`
        );
      }

      return {
        bookingDate,
        amount,
        currency,
        reference: cleanOptional(getMappedValue(row, index.reference)),
        description: cleanOptional(getMappedValue(row, index.description)),
        counterpartyName: cleanOptional(
          getMappedValue(row, index.counterpartyName)
        ),
        counterpartyAccount: normalizeAccount(
          getMappedValue(row, index.counterpartyAccount)
        ),
      };
    });
}

type MappingKey = keyof NorwegianBankCsvMapping;
type ColumnIndices = Partial<Record<MappingKey, number>> & {
  bookingDate: number;
  amount: number;
};

function getColumnIndices(
  headers: string[],
  mapping: NorwegianBankCsvMapping
): ColumnIndices {
  const result: Partial<Record<MappingKey, number>> = {};

  for (const [key, requestedHeader] of Object.entries(mapping) as [
    MappingKey,
    string
  ][]) {
    const wanted = normalizeHeader(requestedHeader);
    const index = headers.indexOf(wanted);
    if (index === -1) {
      throw new ValidationError(
        `Bank statement column "${requestedHeader}" was not found.`
      );
    }
    result[key] = index;
  }

  return result as ColumnIndices;
}

function getMappedValue(
  row: string[],
  index: number | undefined
): string | undefined {
  if (index === undefined) {
    return undefined;
  }
  return row[index];
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase('nb-NO');
}

function cleanOptional(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function normalizeAccount(value?: string): string | undefined {
  const cleaned = cleanOptional(value);
  if (!cleaned) {
    return undefined;
  }
  return cleaned.replace(/\s+/g, '').toUpperCase();
}

function parseBankDate(value: string | undefined, rowNumber: number): string {
  const raw = value?.trim() ?? '';
  let year: string;
  let month: string;
  let day: string;

  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    [, year, month, day] = match;
  } else {
    match = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
    if (!match) {
      throw new ValidationError(
        `Bank statement row ${rowNumber} has unsupported booking date "${raw}".`
      );
    }
    [, day, month, year] = match;
  }

  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== iso
  ) {
    throw new ValidationError(
      `Bank statement row ${rowNumber} has invalid booking date "${raw}".`
    );
  }

  return iso;
}

function parseBankAmount(value: string | undefined, rowNumber: number): number {
  const raw = value?.trim() ?? '';
  let normalized = raw.replace(/[\s\u00A0]/g, '');

  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');

  if (comma >= 0 && dot >= 0) {
    if (comma > dot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (comma >= 0) {
    normalized = normalized.replace(',', '.');
  }

  normalized = normalized.replace(/[^0-9+\-.]/g, '');
  const amount = Number(normalized);
  if (!normalized || !Number.isFinite(amount)) {
    throw new ValidationError(
      `Bank statement row ${rowNumber} has invalid amount "${raw}".`
    );
  }

  return amount;
}

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t'] as const;
  let best = candidates[0];
  let bestCount = -1;

  for (const delimiter of candidates) {
    const count = countDelimiterOutsideQuotes(firstLine, delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

function countDelimiterOutsideQuotes(text: string, delimiter: string): number {
  let count = 0;
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(value);
      value = '';
      continue;
    }

    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  row.push(value);
  rows.push(row);
  return rows;
}
