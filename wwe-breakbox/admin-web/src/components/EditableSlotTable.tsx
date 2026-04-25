import type { SlotDraft } from '../lib/types';

interface Props {
  drafts: SlotDraft[];
  onChange: (drafts: SlotDraft[]) => void;
}

export function EditableSlotTable({ drafts, onChange }: Props) {
  function update(idx: number, patch: Partial<SlotDraft>) {
    onChange(drafts.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }
  function remove(idx: number) {
    onChange(drafts.filter((_, i) => i !== idx));
  }

  if (drafts.length === 0) {
    return <div className="muted">No slots yet — upload a spreadsheet above.</div>;
  }

  return (
    <div className="card editable-slots-table" style={{ padding: 0, maxHeight: 520, overflowY: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Wrestler / Group</th>
            <th>Members</th>
            <th style={{ width: 110 }}>Price</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((d, i) => (
            <tr key={i}>
              <td data-label="#" className="muted">{i + 1}</td>
              <td data-label="Wrestler / Group">
                <input
                  value={d.wrestlerName}
                  onChange={(e) => update(i, { wrestlerName: e.target.value })}
                  style={{ width: '100%' }}
                />
              </td>
              <td data-label="Members">
                <input
                  value={d.members.join(', ')}
                  onChange={(e) =>
                    update(i, {
                      members: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="(none)"
                  style={{ width: '100%' }}
                />
              </td>
              <td data-label="Price">
                <input
                  type="number"
                  value={d.price}
                  min={0}
                  onChange={(e) => update(i, { price: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </td>
              <td data-label="action">
                <button
                  type="button"
                  className="ghost remove-btn"
                  onClick={() => remove(i)}
                  title="Remove row"
                  aria-label={`Remove slot ${i + 1}`}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
