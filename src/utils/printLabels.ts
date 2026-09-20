import { Doc } from 'fyo/model/doc';
import { Invoice } from 'models/baseModels/Invoice/Invoice';

export function getPrintEntryLabel(doc: Doc): string {
  if (doc instanceof Invoice && doc.isReturn) {
    return doc.fyo.t`Credit Note`;
  }

  return doc.schema.label;
}
