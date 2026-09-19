import { ValidationMap } from 'fyo/model/types';
import { validateEmail } from 'fyo/model/validationFunction';
import { AccountingSettings as BaseAccountingSettings } from 'models/baseModels/AccountingSettings/AccountingSettings';
import { validateNorwegianOrganizationNumber } from 'regional/no';

export class AccountingSettings extends BaseAccountingSettings {
  organizationNumber?: string;
  organizationForm?: string;
  vatRegistered?: boolean;
  companyAddress?: string;
  postalCode?: string;
  city?: string;

  validations: ValidationMap = {
    email: validateEmail,
    organizationNumber: validateNorwegianOrganizationNumber,
  };
}
