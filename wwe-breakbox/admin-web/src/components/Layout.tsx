import { Link, Outlet, useNavigate } from 'react-router-dom';
import { signOut, useAuth } from '../lib/useAuth';

export function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>
          <Link to="/" style={{ color: 'inherit' }}>WWE BREAKBOX · ADMIN</Link>
        </h1>
        <div className="row">
          <span className="muted">{user?.email}</span>
          <button className="ghost" onClick={handleSignOut}>Sign out</button>
        </div>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
