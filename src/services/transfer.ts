import type { Cylinder } from '@/types';

export const CSV_FIELDS: (keyof Cylinder)[] = [
  'id','company','status','bookingDate','deliveryDate','startDate','finishDate',
  'cylinderCost','deliveryFee',
  'subsidy','specialUsage','notes','serialNumber','isDemo',
];

export function serializeCylindersCsv(cylinders: readonly Cylinder[]): string {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"','""')}"`;
  return `\ufeff${[CSV_FIELDS.join(','), ...cylinders.map(c => CSV_FIELDS.map(k => quote(c[k])).join(','))].join('\r\n')}`;
}

export function parseCylindersCsv(source: string): Record<string,string>[] {
  const lines = source.replace(/^\ufeff/,'').split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error('The CSV file is empty.');
  const parseLine = (line: string) => {
    const values: string[] = []; let value = ''; let quoted = false;
    for (let i=0; i<line.length; i++) {
      const ch = line[i];
      if (ch === '"' && quoted && line[i+1] === '"') { value += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { values.push(value); value = ''; }
      else value += ch;
    }
    if (quoted) throw new Error('The CSV file contains an unclosed quotation mark.');
    values.push(value); return values;
  };
  const headers = parseLine(lines[0]);
  if (!headers.includes('id') || !headers.includes('company') || (!headers.includes('bookingDate') && !headers.includes('startDate'))) throw new Error('The CSV file is missing required cylinder columns.');
  return lines.slice(1).map(line => Object.fromEntries(parseLine(line).map((value,i)=>[headers[i],value])));
}
