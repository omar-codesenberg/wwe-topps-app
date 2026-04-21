import { useState, type ChangeEvent } from 'react';
import { parseSheet } from '../lib/parseSheet';
import type { SlotDraft } from '../lib/types';

interface Props {
  onParsed: (drafts: SlotDraft[]) => void;
}

export function SheetUploader({ onParsed }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setParsing(true);
    try {
      const drafts = await parseSheet(file);
      if (drafts.length === 0) {
        setError('No usable rows found. Expected column A = wrestler name, column B = price.');
        return;
      }
      onParsed(drafts);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to parse spreadsheet.');
    } finally {
      setParsing(false);
      // Reset so re-uploading the same file re-fires onChange.
      e.target.value = '';
    }
  }

  return (
    <div className="stack">
      <label>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          disabled={parsing}
        />
      </label>
      <p className="muted" style={{ margin: 0 }}>
        Expected format: column A = wrestler / group name, column B = price. No header row required.
        All slots default to brand <strong>RAW</strong> — edit per slot on the event detail page after creation.
      </p>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
