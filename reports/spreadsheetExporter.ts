import { Report } from './Report';

export type SpreadsheetExtension = 'xlsx' | 'ods';
type SpreadsheetValue = string | number;

type ZipEntry = {
  name: string;
  data: Uint8Array;
};

export function getSpreadsheetData(
  report: Report,
  extension: SpreadsheetExtension
): Uint8Array {
  const matrix = getReportMatrix(report);
  return extension === 'xlsx' ? buildXlsx(matrix) : buildOds(matrix);
}

export function getReportMatrix(report: Report): SpreadsheetValue[][] {
  const displayPrecision =
    (report.fyo.singles.SystemSettings?.displayPrecision as number) ?? 2;
  const matrix: SpreadsheetValue[][] = [
    report.columns.map(({ label }) => label),
  ];

  for (const row of report.reportData) {
    if (row.isEmpty) {
      matrix.push(Array<string>(report.columns.length).fill(''));
      continue;
    }

    matrix.push(
      report.columns.map((_, index) => {
        const cell = row.cells[index];
        if (!cell || (cell.value === '' && row.isGroup)) {
          return '';
        }

        const rawValue = cell.rawValue;
        if (rawValue instanceof Date) {
          return rawValue.toISOString();
        }

        if (typeof rawValue === 'number') {
          return Number(rawValue.toFixed(displayPrecision));
        }

        return rawValue === null || rawValue === undefined
          ? ''
          : String(rawValue);
      })
    );
  }

  return matrix;
}

function buildXlsx(matrix: SpreadsheetValue[][]): Uint8Array {
  const rows = matrix
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) =>
            getXlsxCell(value, columnIndex, rowIndex)
          )
          .join('')}</row>`
    )
    .join('');

  const sheetXml = xml(
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
  );

  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: encode(
        xml(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '</Types>'
        )
      ),
    },
    {
      name: '_rels/.rels',
      data: encode(
        xml(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
            '</Relationships>'
        )
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: encode(
        xml(
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>' +
            '</workbook>'
        )
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encode(
        xml(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
            '</Relationships>'
        )
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: encode(sheetXml) },
  ];

  return createStoredZip(entries);
}

function getXlsxCell(
  value: SpreadsheetValue,
  columnIndex: number,
  rowIndex: number
): string {
  const ref = `${getColumnName(columnIndex + 1)}${rowIndex + 1}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" t="n"><v>${String(value)}</v></c>`;
  }

  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    String(value)
  )}</t></is></c>`;
}

function getColumnName(index: number): string {
  let name = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function buildOds(matrix: SpreadsheetValue[][]): Uint8Array {
  const rows = matrix
    .map(
      (row) =>
        '<table:table-row>' +
        row.map((value) => getOdsCell(value)).join('') +
        '</table:table-row>'
    )
    .join('');

  const content = xml(
    '<office:document-content ' +
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
      'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
      'office:version="1.2">' +
      '<office:body><office:spreadsheet>' +
      `<table:table table:name="Report">${rows}</table:table>` +
      '</office:spreadsheet></office:body></office:document-content>'
  );

  const manifest = xml(
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
      '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>' +
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
      '</manifest:manifest>'
  );

  return createStoredZip([
    {
      name: 'mimetype',
      data: encode('application/vnd.oasis.opendocument.spreadsheet'),
    },
    { name: 'content.xml', data: encode(content) },
    { name: 'META-INF/manifest.xml', data: encode(manifest) },
  ]);
}

function getOdsCell(value: SpreadsheetValue): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return (
      `<table:table-cell office:value-type="float" office:value="${String(
        value
      )}"><text:p>${String(value)}</text:p></table:table-cell>`
    );
  }

  return (
    '<table:table-cell office:value-type="string"><text:p>' +
    escapeXml(String(value)) +
    '</text:p></table:table-cell>'
  );
}

function xml(body: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function createStoredZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encode(entry.name);
    const crc = crc32(entry.data);
    const localHeader = concat(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(33),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name
    );

    localParts.push(localHeader, entry.data);

    const centralHeader = concat(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(33),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    );
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }

  const centralDirectory = concat(...centralParts);
  const end = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0)
  );

  return concat(...localParts, centralDirectory, end);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  );
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
