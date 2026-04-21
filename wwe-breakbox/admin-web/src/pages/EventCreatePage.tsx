import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { SheetUploader } from '../components/SheetUploader';
import { EditableSlotTable } from '../components/EditableSlotTable';
import { createEventWithSlots } from '../lib/adminApi';
import { toDatetimeLocalValue } from '../lib/format';
import type { SlotDraft } from '../lib/types';

export function EventCreatePage() {
  const navigate = useNavigate();
  const defaultOpensAt = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(20, 0, 0, 0);
    return toDatetimeLocalValue(d);
  }, []);

  const [title, setTitle] = useState('');
  const [opensAtLocal, setOpensAtLocal] = useState(defaultOpensAt);
  const [description, setDescription] = useState('');
  const [drafts, setDrafts] = useState<SlotDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Title is required.');
    if (!opensAtLocal) return setError('Open date/time is required.');
    if (drafts.length === 0) return setError('Upload a spreadsheet to define slots.');

    const opensAtMs = new Date(opensAtLocal).getTime();
    if (!Number.isFinite(opensAtMs)) return setError('Open date/time is invalid.');

    setSubmitting(true);
    try {
      const result = await createEventWithSlots({
        title: title.trim(),
        opensAt: opensAtMs,
        description: description.trim(),
        slots: drafts,
      });
      navigate(`/events/${result.data.eventId}`, { replace: true });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create event.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <nav className="crumbs"><Link to="/">Events</Link> / Create</nav>
      <h2 style={{ marginTop: 0 }}>Create event</h2>

      <form onSubmit={handleSubmit} className="stack">
        <div className="card">
          <h2>Event info</h2>
          <div className="field">
            <label>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="WWE Topps Chrome 2026 Mega Break"
              required
            />
          </div>
          <div className="field">
            <label>Opens at (date + start time)</label>
            <input
              type="datetime-local"
              value={opensAtLocal}
              onChange={(e) => setOpensAtLocal(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <div className="card">
          <h2>Upload slot sheet</h2>
          <SheetUploader onParsed={setDrafts} />
        </div>

        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Slots ({drafts.length})</h2>
            <div className="spacer" />
            <span className="muted">Edit names, prices, brands, or remove rows before submitting.</span>
          </div>
          <EditableSlotTable drafts={drafts} onChange={setDrafts} />
        </div>

        {error && <div className="error">{error}</div>}

        <div className="row">
          <Link to="/"><button type="button" className="secondary">Cancel</button></Link>
          <div className="spacer" />
          <button type="submit" disabled={submitting || drafts.length === 0}>
            {submitting ? 'Creating…' : `Create event with ${drafts.length} slots`}
          </button>
        </div>
      </form>
    </div>
  );
}
