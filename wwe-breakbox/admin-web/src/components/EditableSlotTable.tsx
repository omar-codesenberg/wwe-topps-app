import { BRANDS, type Brand, type SlotDraft } from '../lib/types';

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
    <div className="card scroll-x" style={{ padding: 0, maxHeight: 520, overflowY: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Wrestler / Group</th>
            <th>Members</th>
            <th style={{ width: 110 }}>Price</th>
            <th style={{ width: 140 }}>Brand</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((d, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              <td>
                <input
                  value={d.wrestlerName}
                  onChange={(e) => update(i, { wrestlerName: e.target.value })}
                  style={{ width: '100%' }}
                />
              </td>
              <td>
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
              <td>
                <input
                  type="number"
                  value={d.price}
                  min={0}
                  onChange={(e) => update(i, { price: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </td>
              <td>
                <select
                  value={d.brand}
                  onChange={(e) => update(i, { brand: e.target.value as Brand })}
                  style={{ width: '100%' }}
                >
                  {BRANDS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </td>
              <td>
                <button className="ghost" onClick={() => remove(i)} title="Remove row">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
