import { DocValue } from 'fyo/core/types';
import { ValidationError } from 'fyo/utils/errors';

export function validateNorwegianOrganizationNumber(value: DocValue) {
  if (value === null || value === undefined || value === '') {
    return;
  }

  if (typeof value !== 'string') {
    throw new ValidationError('Organization number must be a string.');
  }

  const organizationNumber = value.replace(/\s/g, '');
  if (!/^\d{9}$/.test(organizationNumber)) {
    throw new ValidationError(
      'Norwegian organization number must contain 9 digits.'
    );
  }

  const digits = organizationNumber.split('').map(Number);
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce(
    (total, weight, index) => total + digits[index] * weight,
    0
  );

  const remainder = sum % 11;
  const controlDigit = remainder === 0 ? 0 : 11 - remainder;

  if (controlDigit === 10 || controlDigit !== digits[8]) {
    throw new ValidationError('Invalid Norwegian organization number.');
  }
}
