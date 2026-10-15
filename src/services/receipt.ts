import type { CylinderDraft } from '@/types';

export interface ReceiptResult { fields: Partial<CylinderDraft>; message: string }

export function extractReceiptFields(text: string): Partial<CylinderDraft> {
  const fields: Partial<CylinderDraft> = {};
  const normalized = text.replace(/\r/g, '').replace(/[₹]/g, ' Rs ');
  if (/\bindane\b|indian oil|\bio\s*cylinder/i.test(normalized)) fields.company = 'Indane / Indian Oil';
  else if (/\bhp\s*gas\b|hindustan petroleum/i.test(normalized)) fields.company = 'HP Gas / Hindustan Petroleum';
  else if (/bharatgas|bharat petroleum|\bbpcl\b/i.test(normalized)) fields.company = 'Bharatgas / Bharat Petroleum';
  const dateText = normalized.match(/(?:booking|booked|delivery|delivered|invoice|cash memo|date)\D{0,20}(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})/i)?.[1];
  if (dateText) {
    const bits = dateText.split(/[-/]/).map(Number);
    let yyyy: number, mm: number, dd: number;
    if (bits[0] > 999) [yyyy, mm, dd] = bits; else { [dd, mm, yyyy] = bits; if (yyyy < 100) yyyy += yyyy < 50 ? 2000 : 1900; }
    const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    if (mm > 0 && mm <= 12 && dd > 0 && dd <= 31) {
      if (/booking|booked/i.test(normalized.slice(Math.max(0, normalized.indexOf(dateText) - 30), normalized.indexOf(dateText)))) fields.bookingDate = iso;
      else fields.deliveryDate = iso;
    }
  }
  const lines = normalized.split('\n');
  const amount = (pattern: RegExp) => {
    for (const line of lines) {
      if (!pattern.test(line)) continue;
      const matches = [...line.matchAll(/(?:₹|\bRs\.?\s*)?([0-9]{2,6}(?:,[0-9]{3})*(?:\.\d{1,2})?)/gi)];
      const last = matches.at(-1)?.[1];
      if (last) { const value = Number(last.replaceAll(',', '')); if (Number.isFinite(value) && value >= 0 && value <= 100000) return value; }
    }
    return undefined;
  };
  const cost = amount(/refill|cylinder|gas amount|filled|cash memo total|total amount/i);
  const delivery = amount(/delivery|porter|handling/i);
  const subsidy = amount(/subsidy/i);
  if (cost != null) fields.cylinderCost = cost;
  if (delivery != null) fields.deliveryFee = delivery;
  if (subsidy != null) fields.subsidy = subsidy;
  return fields;
}

export async function readReceipt(file: File): Promise<ReceiptResult> {
  if (file.size > 15 * 1024 * 1024) throw new Error('Receipt must be smaller than 15 MB.');
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf && !file.type.startsWith('image/')) throw new Error('Choose a photo or PDF receipt.');
  let text = '';
  if (isPdf) {
    const pdfjs = await import('pdfjs-dist');
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    for (let n = 1; n <= Math.min(pdf.numPages, 5); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      text += `${content.items.map(item => 'str' in item ? item.str : '').join(' ')}\n`;
    }
    if (text.trim().length < 25) {
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const page = await pdf.getPage(1); const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Could not render PDF page.');
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const { createWorker } = await import('tesseract.js'); const worker = await createWorker('eng');
      try { text = (await worker.recognize(canvas)).data.text; } finally { await worker.terminate(); }
    }
  } else {
    const { createWorker } = await import('tesseract.js'); const worker = await createWorker('eng');
    try { text = (await worker.recognize(file)).data.text; } finally { await worker.terminate(); }
  }
  const fields = extractReceiptFields(text);
  return { fields, message: Object.keys(fields).length ? `${Object.keys(fields).length} field(s) suggested from the receipt. Check every value before saving. The file is not kept.` : 'No clear details found. Enter them manually. The file is not kept.' };
}
