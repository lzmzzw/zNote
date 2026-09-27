import Papa from 'papaparse';

export function parseCsv(text: string): { rows: string[][]; error: string | null } {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const error = result.errors.find(item => item.code !== 'UndetectableDelimiter');
  return { rows: result.data, error: error ? `${error.row === undefined ? '' : `第 ${error.row + 1} 行：`}${error.message}` : null };
}
