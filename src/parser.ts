/**
 * Parses a Slice bank UPI credit notification email (raw QP-encoded HTML)
 * and returns the sender name, amount, RRN, and transaction date.
 *
 * Works in both browser and Node.js (v16+).
 */
export type ParseSliceResult = {
  name: string | null;
  amount: number | null;
  rrn: string | null;
  date: Date | null;
};

export function parseSliceEmail(rawHtml: string): ParseSliceResult {
  const decodeQP = (input: string): string => {
    const str = input.replace(/=\r?\n/g, '');
    const chunks: string[] = [];
    let i = 0;

    while (i < str.length) {
      if (
        str[i] === '=' &&
        /[0-9A-Fa-f]/.test(str[i + 1] ?? '') &&
        /[0-9A-Fa-f]/.test(str[i + 2] ?? '')
      ) {
        const bytes: number[] = [];
        while (
          i < str.length &&
          str[i] === '=' &&
          /[0-9A-Fa-f]/.test(str[i + 1] ?? '') &&
          /[0-9A-Fa-f]/.test(str[i + 2] ?? '')
        ) {
          bytes.push(parseInt(str.slice(i + 1, i + 3), 16));
          i += 3;
        }
        chunks.push(new TextDecoder('utf-8').decode(new Uint8Array(bytes)));
      } else {
        chunks.push(str[i++]);
      }
    }

    return chunks.join('');
  };

  const html = decodeQP(rawHtml);

  const amountMatch = html.match(/received\s*₹([\d,]+(?:\.\d+)?)\s*via\s*UPI/i);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

  const getCellValue = (label: string): string | null => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<td[^>]*>\\s*${escaped}\\s*<\\/td>\\s*<td[^>]*>\\s*([\\s\\S]*?)\\s*<\\/td>`, 'i');
    const m = html.match(re);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
  };

  const name = getCellValue('From');
  const rrn = getCellValue('RRN');
  const dateStr = getCellValue('Transaction date');

  const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  let date: Date | null = null;
  if (dateStr) {
    const m = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (m) {
      const day = parseInt(m[1], 10);
      const month = MONTHS[m[2].toLowerCase()];
      const yr = parseInt(m[3], 10);
      const year = yr < 100 ? 2000 + yr : yr;
      date = new Date(year, month, day);
    }
  }

  return { name, amount, rrn, date };
}
