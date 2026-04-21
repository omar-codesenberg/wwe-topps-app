import * as XLSX from 'xlsx';
import type { Brand, SlotDraft } from './types';

/**
 * Parse a .xlsx/.xls workbook the admin uploaded and return an array of slot
 * drafts. Defaults brand to 'RAW' (admin can edit per-row before submitting,
 * and brand-per-slot edits also happen on the event detail page).
 *
 * Expected sheet shape: column A = wrestler name, column B = price.
 * No header row required — any row whose first cell is non-empty and second
 * cell is a positive number is treated as a slot. Other rows are ignored.
 */
export async function parseSheet(file: File, defaultBrand: Brand = 'RAW'): Promise<SlotDraft[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  if (!firstSheet) return [];

  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 });
  const drafts: SlotDraft[] = [];

  for (const row of rows) {
    const nameRaw = row[0];
    const priceRaw = row[1];
    if (typeof nameRaw !== 'string') continue;
    const wrestlerName = nameRaw.trim();
    if (!wrestlerName) continue;
    const price = typeof priceRaw === 'number' ? priceRaw : Number(priceRaw);
    if (!Number.isFinite(price) || price < 0) continue;

    drafts.push({
      wrestlerName,
      members: deriveMembers(wrestlerName),
      price,
      brand: defaultBrand,
    });
  }

  return drafts;
}

/**
 * Best-effort split of grouped names like "DIY - Johnny Gargano, Tommaso Ciampa"
 * or "Asuka, Kairi Sane" into a members[] list. The wrestlerName itself is
 * preserved as-is — admin can fix anything in the review table.
 */
function deriveMembers(name: string): string[] {
  // "Group - A, B, C" → [A, B, C]
  const dashIdx = name.indexOf(' - ');
  if (dashIdx > 0) {
    const after = name.slice(dashIdx + 3);
    const parts = after.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts;
  }
  // "A, B" or "A & B"
  if (name.includes(',') || name.includes('&')) {
    const parts = name.split(/,|&/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every((p) => p.length < 50)) return parts;
  }
  return [];
}
