import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export async function validateAgainstOfficialSaft140Xsd(xml: string) {
  const probe = spawnSync('xmllint', ['--version'], {
    encoding: 'utf8',
  });

  if (probe.error) {
    throw new Error(
      'xmllint is required for SAF-T XSD validation. On Debian/Ubuntu/Linux Mint install package libxml2-utils.'
    );
  }

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'frappe-books-saft-')
  );
  const xsdPath = path.join(
    __dirname,
    'fixtures',
    'saft',
    'Norwegian_SAF-T_Financial_Schema_v_1.40.xsd'
  );
  const xmlPath = path.join(tempDir, 'Norwegian_SAF-T_Financial_1.40.xml');

  try {
    await fs.writeFile(xmlPath, xml, 'utf8');

    const validation = spawnSync(
      'xmllint',
      ['--nonet', '--noout', '--schema', xsdPath, xmlPath],
      { encoding: 'utf8' }
    );

    return {
      valid: validation.status === 0,
      output: [validation.stdout, validation.stderr]
        .filter(Boolean)
        .join('\n')
        .trim(),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
