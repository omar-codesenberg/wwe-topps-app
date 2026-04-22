import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  subscribeToEvent,
  subscribeToSlots,
  subscribeToEventPurchases,
  fetchUser,
} from '../lib/firestore';
import { setSlotClosed, setSlotBrand, startEvent, closeEvent } from '../lib/adminApi';
import { formatDateTime, formatMoney } from '../lib/format';
import { BRANDS, type Brand, type BreakEvent, type Purchase, type Slot, type UserProfile } from '../lib/types';

export function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<BreakEvent | null | undefined>(undefined);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  const [startingEvent, setStartingEvent] = useState(false);
  const [closingEvent, setClosingEvent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    const u1 = subscribeToEvent(eventId, setEvent);
    const u2 = subscribeToSlots(eventId, setSlots);
    const u3 = subscribeToEventPurchases(eventId, setPurchases);
    return () => { u1(); u2(); u3(); };
  }, [eventId]);

  if (!eventId) return <div className="error">Missing event id.</div>;
  if (event === undefined) return <div className="muted">Loading…</div>;
  if (event === null) return <div className="error">Event not found.</div>;

  async function handleClose(slot: Slot, closed: boolean) {
    if (!eventId) return;
    setError(null);
    setPendingSlotId(slot.id);
    try {
      await setSlotClosed({ eventId, slotId: slot.id, closed });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update slot.');
    } finally {
      setPendingSlotId(null);
    }
  }

  async function handleStart() {
    if (!eventId) return;
    if (!window.confirm(`Start "${event!.title}" now? This will open slots for purchase.`)) return;
    setError(null);
    setStartingEvent(true);
    try {
      await startEvent({ eventId });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to start event.');
    } finally {
      setStartingEvent(false);
    }
  }

  async function handleEndEvent() {
    if (!eventId) return;
    if (
      !window.confirm(
        `End "${event!.title}" and mark it completed? Users will no longer be able to claim remaining slots.`
      )
    )
      return;
    setError(null);
    setClosingEvent(true);
    try {
      await closeEvent({ eventId });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to end event.');
    } finally {
      setClosingEvent(false);
    }
  }

  async function handleBrand(slot: Slot, brand: Brand) {
    if (!eventId) return;
    setError(null);
    try {
      await setSlotBrand({ eventId, slotId: slot.id, brand });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update brand.');
    }
  }

  return (
    <div>
      <nav className="crumbs"><Link to="/">Events</Link> / {event.title}</nav>
      <div className="row stack-mobile" style={{ marginBottom: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>{event.title}</h2>
          <span className={`badge ${event.status}`}>{event.status}</span>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
          <span>Opens {formatDateTime(event.opensAt)}</span>
          <span>·</span>
          <span>{event.soldSlots} / {event.totalSlots} sold</span>
        </div>
        {event.status === 'upcoming' && (
          <button onClick={handleStart} disabled={startingEvent}>
            {startingEvent ? 'Starting…' : 'Start event'}
          </button>
        )}
        {event.status === 'live' && (
          <button className="danger" onClick={handleEndEvent} disabled={closingEvent}>
            {closingEvent ? 'Ending…' : 'End event'}
          </button>
        )}
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card">
        <h2>Slots ({slots.length})</h2>
        <div className="scroll-x" style={{ maxHeight: 600, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Wrestler</th>
                <th>Members</th>
                <th>Brand</th>
                <th>Price</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id}>
                  <td>{slot.wrestlerName}</td>
                  <td className="muted" style={{ maxWidth: 240 }}>{slot.members.join(', ') || '—'}</td>
                  <td>
                    <select
                      value={slot.brand}
                      onChange={(e) => handleBrand(slot, e.target.value as Brand)}
                    >
                      {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td>{formatMoney(slot.price)}</td>
                  <td><span className={`badge ${slot.status}`}>{slot.status}</span></td>
                  <td>
                    {slot.status === 'sold' ? (
                      <span className="muted">—</span>
                    ) : slot.status === 'closed' ? (
                      <button
                        className="secondary"
                        disabled={pendingSlotId === slot.id}
                        onClick={() => handleClose(slot, false)}
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        className="danger"
                        disabled={pendingSlotId === slot.id}
                        onClick={() => handleClose(slot, true)}
                      >
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PurchasesPanel purchases={purchases} />
    </div>
  );
}

function PurchasesPanel({ purchases }: { purchases: Purchase[] }) {
  const uids = useMemo(() => Array.from(new Set(purchases.map((p) => p.userId))), [purchases]);
  const [users, setUsers] = useState<Record<string, UserProfile | null>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      uids.map(async (uid) => [uid, await fetchUser(uid)] as const)
    ).then((entries) => {
      if (cancelled) return;
      setUsers(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [uids.join('|')]);

  return (
    <div className="card">
      <h2>Purchases ({purchases.length})</h2>
      {purchases.length === 0 ? (
        <div className="muted">No purchases yet.</div>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Wrestler</th>
                <th>Price</th>
                <th>Purchased</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const user = users[p.userId];
                return (
                  <tr key={p.id}>
                    <td>
                      {user ? (
                        <Link to={`/users/${p.userId}`}>{user.username || user.email || p.userId}</Link>
                      ) : (
                        <Link to={`/users/${p.userId}`}>{p.userId.slice(0, 8)}…</Link>
                      )}
                      {user?.legacyUser && <span className="badge sold" style={{ marginLeft: 6 }}>LEGACY</span>}
                    </td>
                    <td>{p.wrestlerName}</td>
                    <td>{formatMoney(p.price)}</td>
                    <td>{formatDateTime(p.purchasedAt)}</td>
                    <td><Link to={`/users/${p.userId}`} className="muted">Open user →</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
