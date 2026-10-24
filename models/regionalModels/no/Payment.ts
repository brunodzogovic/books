import { t } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';
import { Payment as BasePayment } from 'models/baseModels/Payment/Payment';
import { ModelNameEnum } from 'models/types';

type ExistingBankPayment = {
  name: string;
  cancelled?: boolean | null;
};

export class Payment extends BasePayment {
  norwegianBankTransactionFingerprint?: string;

  async validate() {
    await super.validate();

    const fingerprint = this.get('norwegianBankTransactionFingerprint');
    if (typeof fingerprint !== 'string' || !fingerprint.trim()) {
      return;
    }

    const existing = (await this.fyo.db.getAllRaw(ModelNameEnum.Payment, {
      fields: ['name', 'cancelled'],
      filters: {
        norwegianBankTransactionFingerprint: fingerprint,
      },
    })) as ExistingBankPayment[];

    const duplicate = existing.find(
      ({ name, cancelled }) => name !== this.name && !cancelled
    );

    if (!duplicate) {
      return;
    }

    throw new ValidationError(
      t`Bank transaction has already been reconciled by payment ${duplicate.name}.`
    );
  }
}
