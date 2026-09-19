import { Fyo } from 'fyo';
import { createIndianRecords } from './in/in';
import { createNorwegianRecords } from './no/no';

export async function createRegionalRecords(country: string, fyo: Fyo) {
  if (country === 'India') {
    await createIndianRecords(fyo);
  }

  if (country === 'Norway') {
    await createNorwegianRecords(fyo);
  }

  return;
}
