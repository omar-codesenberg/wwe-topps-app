import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscribeToEvents } from '../lib/firestore';
import { formatDateTime } from '../lib/format';
import type { BreakEvent } from '../lib/types';

export function EventsListPage() {
  const [events, setEvents] = useState<BreakEvent[] | null>(null);

  useEffect(() => subscribeToEvents(setEvents), []);

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Events</h2>
        <div className="spacer" />
        <Link to="/events/new"><button>+ Create event</button></Link>
      </div>

      {events === null && <div className="muted">Loading…</div>}
      {events && events.length === 0 && (
        <div className="card muted">No events yet. Create one to get started.</div>
      )}

      {events && events.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Opens</th>
                <th>Sold / Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td><Link to={`/events/${ev.id}`}>{ev.title}</Link></td>
                  <td><span className={`badge ${ev.status}`}>{ev.status}</span></td>
                  <td>{formatDateTime(ev.opensAt)}</td>
                  <td>{ev.soldSlots} / {ev.totalSlots}</td>
                  <td><Link to={`/events/${ev.id}`} className="muted">Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
