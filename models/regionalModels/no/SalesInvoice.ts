import { t } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';
import { SalesInvoice as BaseSalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { ModelNameEnum } from 'models/types';

export class SalesInvoice extends BaseSalesInvoice {
  dueDate?: string | Date;
  deliveryDate?: string | Date;
  deliveryPlace?: string;

  async beforeSubmit() {
    await super.beforeSubmit();

    const accountingSettings = this.fyo.singles.AccountingSettings;
    const sellerOrganizationNumber = accountingSettings?.get(
      'organizationNumber'
    ) as string | undefined;

    if (!sellerOrganizationNumber) {
      throw new ValidationError(
        t`Organization number is required before submitting a Norwegian sales invoice.`
      );
    }

    if (!this.get('dueDate')) {
      throw new ValidationError(
        t`Payment due date is required on Norwegian sales invoices.`
      );
    }

    if (!this.get('deliveryDate')) {
      throw new ValidationError(
        t`Delivery date and time is required on Norwegian sales invoices.`
      );
    }

    if (!this.get('deliveryPlace')) {
      throw new ValidationError(
        t`Delivery place is required on Norwegian sales invoices.`
      );
    }

    const party = await this.fyo.doc.getDoc(
      ModelNameEnum.Party,
      this.party
    );
    const buyerOrganizationNumber = party?.get('organizationNumber');
    const buyerAddress = party?.get('address');

    if (!buyerOrganizationNumber && !buyerAddress) {
      throw new ValidationError(
        t`Norwegian sales invoices require the customer to have an address or organization number.`
      );
    }
  }
}
