import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth } from '../lib/firebase';
import { signOut, useAuth } from '../lib/useAuth';

export function LoginPage() {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation() as { state?: { from?: string } };
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return <div className="login-shell"><div className="muted">Loading…</div></div>;
  }
  if (user && isAdmin) {
    return <Navigate to={location.state?.from ?? '/'} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
      const tokenResult = await cred.user.getIdTokenResult(true);
      if (tokenResult.claims.admin !== true) {
        await signOut();
        setError('This account does not have admin access.');
        return;
      }
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err: any) {
      setError(err?.message ?? 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>ADMIN SIGN IN</h1>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
        <button type="submit" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
