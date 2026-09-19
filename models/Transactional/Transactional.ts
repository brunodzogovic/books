import { Doc } from 'fyo/model/doc';
import { ModelNameEnum } from 'models/types';
import { validateNorwegianAccountingPeriod } from 'regional/noPeriodLock';
import { LedgerPosting } from './LedgerPosting';

/**
 * # Transactional
 *
 * Any model that creates ledger entries on submit should extend the
 * `Transactional` model.
 *
 * Example of transactional models:
 * - Invoice
 * - Payment
 * - JournalEntry
 *
 * Basically it does the following:
 * - `afterSubmit`: create the ledger entries.
 * - `afterCancel`: create reverse ledger entries.
 * - `afterDelete`: delete the normal and reversed ledger entries.
 */

export abstract class Transactional extends Doc {
  date?: Date;

  get isTransactional() {
    return true;
  }

  override get canDelete() {
    /*
     * Norwegian accounting records remain part of the audit trail after
     * posting. A cancelled transaction is reversed in the ledger, not erased
     * together with its original and reversal entries.
     */
    if (
      this.fyo.singles.SystemSettings?.countryCode === 'no' &&
      (this.submitted || this.cancelled)
    ) {
      return false;
    }

    return super.canDelete;
  }

  abstract getPosting(): Promise<LedgerPosting | null>;

  async validate() {
    await super.validate();
    if (!this.isTransactional) {
      return;
    }

    if (this.submitted || this.cancelled) {
      validateNorwegianAccountingPeriod(this);
    }

    const posting = await this.getPosting();
    if (posting === null) {
      return;
    }

    posting.validate();
  }

  async afterSubmit(): Promise<void> {
    await super.afterSubmit();
    if (!this.isTransactional) {
      return;
    }

    const posting = await this.getPosting();
    if (posting === null) {
      return;
    }

    await posting.post();
  }

  async afterCancel(): Promise<void> {
    await super.afterCancel();
    if (!this.isTransactional) {
      return;
    }

    const posting = await this.getPosting();
    if (posting === null) {
      return;
    }

    await posting.postReverse();
  }

  async afterDelete(): Promise<void> {
    await super.afterDelete();
    if (!this.isTransactional) {
      return;
    }

    const ledgerEntryIds = (await this.fyo.db.getAll(
      ModelNameEnum.AccountingLedgerEntry,
      {
        fields: ['name'],
        filters: {
          referenceType: this.schemaName,
          referenceName: this.name!,
        },
      }
    )) as { name: string }[];

    for (const { name } of ledgerEntryIds) {
      const ledgerEntryDoc = await this.fyo.doc.getDoc(
        ModelNameEnum.AccountingLedgerEntry,
        name
      );
      await ledgerEntryDoc.delete();
    }
  }
}
