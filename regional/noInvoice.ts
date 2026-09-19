import { Invoice } from 'models/baseModels/Invoice/Invoice';
import { Money } from 'pesa';

export type NorwegianInvoiceCurrencyDisclosure = {
  companyCurrency: string;
  showTaxInCompanyCurrency: boolean;
  taxTotalCompanyCurrency: Money;
  netTotalCompanyCurrency: Money;
};

export async function getNorwegianInvoiceCurrencyDisclosure(
  invoice: Invoice
): Promise<NorwegianInvoiceCurrencyDisclosure> {
  const exchangeRate = invoice.exchangeRate ?? 1;
  const taxTotalCompanyCurrency = (await invoice.getTotalTax()).mul(
    exchangeRate
  );
  const netTotalCompanyCurrency = (
    invoice.netTotal ?? invoice.fyo.pesa(0)
  ).mul(exchangeRate);

  return {
    companyCurrency: invoice.companyCurrency,
    showTaxInCompanyCurrency:
      invoice.isMultiCurrency && !taxTotalCompanyCurrency.isZero(),
    taxTotalCompanyCurrency,
    netTotalCompanyCurrency,
  };
}
