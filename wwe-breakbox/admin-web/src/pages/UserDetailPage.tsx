import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { subscribeToUser, subscribeToUserPurchases } from '../lib/firestore';
import { setUserLegacy } from '../lib/adminApi';
import { formatDateTime, formatMoney } from '../lib/format';
import type { Purchase, UserProfile } from '../lib/types';

export function UserDetailPage() {
  const { uid } = useParams<{ uid: string }>();
  const [user, setUser] = useState<UserProfile | null | undefined>(undefined);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const u1 = subscribeToUser(uid, setUser);
    const u2 = subscribeToUserPurchases(uid, setPurchases);
    return () => { u1(); u2(); };
  }, [uid]);

  if (!uid) return <div className="error">Missing user id.</div>;
  if (user === undefined) return <div className="muted">Loading…</div>;
  if (user === null) return <div className="error">User not found.</div>;

  async function handleLegacyToggle(next: boolean) {
    if (!uid) return;
    setSubmitting(true);
    setError(null);
    try {
      await setUserLegacy({ uid, legacyUser: next });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update legacy flag.');
    } finally {
      setSubmitting(false);
    }
  }

  const addr = user.shippingAddress;

  return (
    <div>
      <nav className="crumbs">
        <Link to="/">Events</Link> / User
      </nav>
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{user.username || user.displayName || user.email || uid}</h2>
        {user.legacyUser && <span className="badge sold">LEGACY</span>}
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card">
        <h2>Profile</h2>
        <dl className="kv">
          <dt>Username</dt><dd>{user.username || <span className="muted">—</span>}</dd>
          <dt>Display name</dt><dd>{user.displayName || <span className="muted">—</span>}</dd>
          <dt>First / last name</dt>
          <dd>{[user.firstName, user.lastName].filter(Boolean).join(' ') || <span className="muted">—</span>}</dd>
          <dt>Email</dt><dd>{user.email || <span className="muted">—</span>}</dd>
          <dt>Wants base card</dt><dd>{user.wantBaseCards ? 'Yes' : 'No'}</dd>
          <dt>Purchases</dt><dd>{user.purchaseCount}</dd>
          <dt>Balance</dt><dd>{formatMoney(user.balance)}</dd>
          <dt>Joined</dt><dd>{formatDateTime(user.createdAt)}</dd>
          <dt>Shipping address</dt>
          <dd>
            {addr ? (
              <div style={{ whiteSpace: 'pre-line' }}>
                {addr.line1}{'\n'}
                {addr.line2 ? `${addr.line2}\n` : ''}
                {addr.city}, {addr.province} {addr.postalCode}{'\n'}
                {addr.country}
              </div>
            ) : (
              <span className="muted">—</span>
            )}
          </dd>
          <dt>Legacy user</dt>
          <dd>
            <label className="toggle">
              <input
                type="checkbox"
                checked={user.legacyUser}
                disabled={submitting}
                onChange={(e) => handleLegacyToggle(e.target.checked)}
              />
              <span className="slider" />
            </label>
            <span className="muted" style={{ marginLeft: 12 }}>
              {user.legacyUser ? 'Marked as legacy.' : 'Not marked as legacy.'}
            </span>
          </dd>
        </dl>
      </div>

      <div className="card">
        <h2>Purchase history ({purchases.length})</h2>
        {purchases.length === 0 ? (
          <div className="muted">No purchases yet.</div>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Wrestler</th>
                  <th>Brand</th>
                  <th>Price</th>
                  <th>Purchased</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`/events/${p.eventId}`}>{p.eventTitle}</Link></td>
                    <td>{p.wrestlerName}</td>
                    <td><span className={`brand ${p.brand}`}>{p.brand}</span></td>
                    <td>{formatMoney(p.price)}</td>
                    <td>{formatDateTime(p.purchasedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
