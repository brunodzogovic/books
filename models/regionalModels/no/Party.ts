import { ValidationMap } from 'fyo/model/types';
import { Party as BaseParty } from 'models/baseModels/Party/Party';
import { validateNorwegianOrganizationNumber } from 'regional/no';

export class Party extends BaseParty {
  organizationNumber?: string;

  validations: ValidationMap = {
    ...super.validations,
    organizationNumber: validateNorwegianOrganizationNumber,
  };
}
