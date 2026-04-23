import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { fetchUsersPage } from '../lib/firestore';
import { formatDate, formatMoney } from '../lib/format';
import type { UserProfile } from '../lib/types';

const PAGE_SIZE = 50;

export function UsersListPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [cursorStack, setCursorStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);

  async function loadPage(cursorStackNext: (QueryDocumentSnapshot<DocumentData> | null)[], idx: number) {
    setLoading(true);
    setError(null);
    try {
      const { users: u, lastDoc, hasMore: more } = await fetchUsersPage(PAGE_SIZE, cursorStackNext[idx]);
      setUsers(u);
      setHasMore(more);
      if (more && cursorStackNext.length === idx + 1) {
        setCursorStack([...cursorStackNext, lastDoc]);
      } else {
        setCursorStack(cursorStackNext);
      }
      setPageIdx(idx);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage([null], 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNext() {
    if (!hasMore || loading) return;
    loadPage(cursorStack, pageIdx + 1);
  }

  function handlePrev() {
    if (pageIdx === 0 || loading) return;
    loadPage(cursorStack, pageIdx - 1);
  }

  const firstIdx = pageIdx * PAGE_SIZE + 1;
  const lastIdx = pageIdx * PAGE_SIZE + users.length;

  return (
    <div>
      <div className="row stack-mobile" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <div className="spacer" />
        <span className="muted">
          {loading && users.length === 0
            ? 'Loading…'
            : users.length === 0
              ? 'No users'
              : `Showing ${firstIdx}–${lastIdx}`}
        </span>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {users.length > 0 && (
        <div className="card scroll-x" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Name</th>
                <th>Purchases</th>
                <th>Balance</th>
                <th>Legacy</th>
                <th>Wants base</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
                return (
                  <tr key={u.uid}>
                    <td>
                      <Link to={`/users/${u.uid}`}>
                        {u.username || u.displayName || <span className="muted">{u.uid.slice(0, 8)}…</span>}
                      </Link>
                    </td>
                    <td>{u.email || <span className="muted">—</span>}</td>
                    <td>{fullName || <span className="muted">—</span>}</td>
                    <td>{u.purchaseCount}</td>
                    <td>{formatMoney(u.balance)}</td>
                    <td>
                      {u.legacyUser ? (
                        <span className="badge sold">LEGACY</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{u.wantBaseCards ? 'Yes' : 'No'}</td>
                    <td>{formatDate(u.createdAt)}</td>
                    <td><Link to={`/users/${u.uid}`} className="muted">Open →</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="row stack-mobile" style={{ marginTop: 16 }}>
        <button className="secondary" onClick={handlePrev} disabled={pageIdx === 0 || loading}>
          ← Previous
        </button>
        <span className="muted">Page {pageIdx + 1}</span>
        <div className="spacer" />
        <button onClick={handleNext} disabled={!hasMore || loading}>
          Next →
        </button>
      </div>
    </div>
  );
}
