import { SchemaStub } from '../../types';
import AccountingSettings from './AccountingSettings.json';
import Tax from './Tax.json';
import Party from './Party.json';
import SalesInvoice from './SalesInvoice.json';
import PurchaseInvoice from './PurchaseInvoice.json';
import Payment from './Payment.json';
import JournalEntry from './JournalEntry.json';
import SalesInvoiceItem from './SalesInvoiceItem.json';
import PurchaseInvoiceItem from './PurchaseInvoiceItem.json';
import Account from './Account.json';
import saftGroupingOptions from 'fixtures/noSaftGroupingOptions.json';

export default [
  {
    ...Account,
    fields: Account.fields.map((field) => ({
      ...field,
      options: saftGroupingOptions,
    })),
  },
  AccountingSettings,
  Party,
  SalesInvoice,
  PurchaseInvoice,
  Payment,
  JournalEntry,
  SalesInvoiceItem,
  PurchaseInvoiceItem,
  Tax,
] as SchemaStub[];
