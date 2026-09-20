import { Fyo, t } from 'fyo';
import { Action } from 'fyo/model/types';
import { ValidationError } from 'fyo/utils/errors';
import { DateTime } from 'luxon';
import { Invoice } from 'models/baseModels/Invoice/Invoice';
import { ModelNameEnum } from 'models/types';
import { Report } from 'reports/Report';
import getCommonExportActions from 'reports/commonExporter';
import { ColumnField, ReportData, ReportRow } from 'reports/types';
import { Field } from 'schemas/types';
import { buildNorwegianSaftFinancial140 } from 'regional/noSaft';

export type NorwegianVatSummaryRow = {
  taxCode: string;
  standardTaxCode: string;
  templateName: string;
  basis: number;
  vatAmount: number;
};

function isDateWithinSelection(
  value: unknown,
  fromDate?: string,
  toDate?: string
): boolean {
  const isoDate =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value ?? '').slice(0, 10);

  if (!isoDate) {
    return false;
  }

  if (fromDate && isoDate < fromDate) {
    return false;
  }

  if (toDate && isoDate > toDate) {
    return false;
  }

  return true;
}

async function assertNoDirectlyCancelledSalesInvoices(
  fyo: Fyo,
  fromDate?: string,
  toDate?: string
): Promise<void> {
  const cancelled = (await fyo.db.getAllRaw(ModelNameEnum.SalesInvoice, {
    fields: ['name', 'date'],
    filters: {
      submitted: true,
      cancelled: true,
    },
  })) as { name: string; date: unknown }[];

  for (const invoice of cancelled) {
    let relevant = isDateWithinSelection(invoice.date, fromDate, toDate);

    if (!relevant) {
      const ledgerRows = await fyo.db.getAllRaw(
        ModelNameEnum.AccountingLedgerEntry,
        {
          fields: ['date', 'reverts'],
          filters: {
            referenceType: ModelNameEnum.SalesInvoice,
            referenceName: invoice.name,
          },
        }
      );

      relevant = ledgerRows.some(
        ({ date, reverts }) =>
          Boolean(reverts) &&
          isDateWithinSelection(date, fromDate, toDate)
      );
    }

    if (relevant) {
      throw new ValidationError(
        t`Norwegian VAT summary cannot automatically classify directly cancelled sales invoice ${invoice.name}. Review the correction and use a credit note workflow.`
      );
    }
  }
}

export async function getNorwegianVatSummary(
  fyo: Fyo,
  fromDate?: string,
  toDate?: string
): Promise<NorwegianVatSummaryRow[]> {
  await assertNoDirectlyCancelledSalesInvoices(fyo, fromDate, toDate);
  const summary = new Map<string, NorwegianVatSummaryRow>();

  for (const schemaName of [
    ModelNameEnum.SalesInvoice,
    ModelNameEnum.PurchaseInvoice,
  ]) {
    const date: string[] = [];
    if (toDate) {
      date.push('<=', toDate);
    }
    if (fromDate) {
      date.push('>=', fromDate);
    }

    const invoices = (await fyo.db.getAllRaw(schemaName, {
      fields: ['name'],
      filters: {
        ...(date.length ? { date } : {}),
        submitted: true,
        cancelled: false,
      },
    })) as { name: string }[];

    for (const { name } of invoices) {
      const invoice = (await fyo.doc.getDoc(schemaName, name)) as Invoice;
      const taxItems = await invoice.getTaxItems();

      for (const taxItem of taxItems) {
        let taxCode = taxItem.taxCode ?? '';
        let standardTaxCode = taxItem.standardTaxCode ?? '';

        /*
         * Legacy invoices created before VAT snapshots were introduced can
         * still be reported using the current tax-template mapping.
         */
        if (!taxCode || !standardTaxCode) {
          const tax = await fyo.doc.getDoc('Tax', taxItem.tax);
          taxCode = (tax?.get('taxCode') as string | undefined) ?? '';
          standardTaxCode =
            (tax?.get('standardTaxCode') as string | undefined) ?? '';
        }

        if (!taxCode || !standardTaxCode) {
          throw new ValidationError(
            t`VAT mapping is missing for ${schemaName} ${name}, tax template ${taxItem.tax}.`
          );
        }

        const key = `${standardTaxCode}:${taxCode}`;
        const row = summary.get(key) ?? {
          taxCode,
          standardTaxCode,
          templateName: taxItem.tax,
          basis: 0,
          vatAmount: 0,
        };

        const exchangeRate = taxItem.exchangeRate ?? 1;
        row.basis += taxItem.fullAmount.mul(exchangeRate).float;
        row.vatAmount += taxItem.taxAmount.mul(exchangeRate).float;
        summary.set(key, row);
      }
    }
  }

  return [...summary.values()].sort((a, b) =>
    a.standardTaxCode.localeCompare(b.standardTaxCode, undefined, {
      numeric: true,
    })
  );
}

export class NorwegianVAT extends Report {
  static title = 'Norwegian VAT Summary';
  static reportName = 'norwegian-vat';

  fromDate?: string;
  toDate?: string;
  loading = false;

  setDefaultFilters() {
    const now = DateTime.local();
    this.fromDate ??= now.startOf('year').toISODate();
    this.toDate ??= now.endOf('year').toISODate();
  }

  getFilters(): Field[] {
    return [
      {
        fieldtype: 'Date',
        label: t`From Date`,
        placeholder: t`From Date`,
        fieldname: 'fromDate',
      },
      {
        fieldtype: 'Date',
        label: t`To Date`,
        placeholder: t`To Date`,
        fieldname: 'toDate',
      },
    ];
  }

  getColumns(): ColumnField[] {
    return [
      {
        label: t`SAF-T VAT Code`,
        fieldname: 'standardTaxCode',
        fieldtype: 'Data',
        width: 0.7,
      },
      {
        label: t`System VAT Code`,
        fieldname: 'taxCode',
        fieldtype: 'Data',
      },
      {
        label: t`Tax Template`,
        fieldname: 'templateName',
        fieldtype: 'Data',
        width: 1.5,
      },
      {
        label: t`VAT Basis`,
        fieldname: 'basis',
        fieldtype: 'Currency',
      },
      {
        label: t`VAT Amount`,
        fieldname: 'vatAmount',
        fieldtype: 'Currency',
      },
    ];
  }

  async setReportData(): Promise<void> {
    this.loading = true;
    const rows = await getNorwegianVatSummary(
      this.fyo,
      this.fromDate,
      this.toDate
    );

    this.reportData = rows.map((row) => this.getReportRow(row));
    this.loading = false;
  }

  getReportRow(row: NorwegianVatSummaryRow): ReportRow {
    const cells = this.columns.map(({ fieldname, fieldtype, width }) => {
      const rawValue = row[fieldname as keyof NorwegianVatSummaryRow];
      return {
        rawValue,
        value: this.fyo.format(rawValue, fieldtype),
        align: fieldtype === 'Currency' ? ('right' as const) : ('left' as const),
        width: width ?? 1,
      };
    });

    return { cells };
  }

  getActions(): Action[] {
    if (this.fyo.singles.SystemSettings?.countryCode !== 'no') {
      return [];
    }

    return [
      ...getCommonExportActions(this),
      {
        group: t`Export`,
        label: t`SAF-T Financial 1.40 XML`,
        type: 'primary',
        action: async () => {
          if (!this.fromDate || !this.toDate) {
            throw new ValidationError(
              t`From Date and To Date are required for SAF-T export.`
            );
          }

          const result = await buildNorwegianSaftFinancial140(this.fyo, {
            fromDate: this.fromDate,
            toDate: this.toDate,
          });

          const { getSavePath, showExportInFolder } = await import(
            'src/utils/ui'
          );
          const organizationNumber = String(
            this.fyo.singles.AccountingSettings?.organizationNumber ?? 'company'
          )
            .trim()
            .replace(/\s+/g, '');

          const fileName = [
            'SAF-T_Financial_1.40',
            organizationNumber || 'company',
            this.fromDate,
            this.toDate,
          ].join('_');

          const { canceled, filePath } = await getSavePath(fileName, 'xml');
          if (canceled || !filePath) {
            return;
          }

          await ipc.saveData(result.xml, filePath);
          showExportInFolder(t`SAF-T Export Successful`, filePath);
        },
      },
    ];
  }
}
