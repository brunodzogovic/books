import { SchemaStub } from 'schemas/types';
import IndianSchemas from './in';
import SwissSchemas from './ch';
import NorwegianSchemas from './no';

/**
 * Regional Schemas are exported by country code.
 */
export default { in: IndianSchemas, ch: SwissSchemas, no: NorwegianSchemas } as Record<
  string,
  SchemaStub[]
>;
