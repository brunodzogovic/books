import { SchemaStub } from '../../types';
import AccountingSettings from './AccountingSettings.json';
import Tax from './Tax.json';
import Party from './Party.json';
import SalesInvoice from './SalesInvoice.json';
import PurchaseInvoice from './PurchaseInvoice.json';
import Payment from './Payment.json';
import JournalEntry from './JournalEntry.json';

export default [
  AccountingSettings,
  Party,
  SalesInvoice,
  PurchaseInvoice,
  Payment,
  JournalEntry,
  Tax,
] as SchemaStub[];
