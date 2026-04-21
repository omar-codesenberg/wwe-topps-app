import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { firebaseAuth } from './firebase';

export interface AdminAuthState {
  loading: boolean;
  user: User | null;
  isAdmin: boolean;
}

/**
 * Subscribes to Firebase Auth and resolves the `admin: true` custom claim from
 * the user's ID token. Returns loading=true until both the auth state and the
 * token result have been fetched at least once.
 */
export function useAuth(): AdminAuthState {
  const [state, setState] = useState<AdminAuthState>({
    loading: true,
    user: null,
    isAdmin: false,
  });

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, async (user) => {
      if (!user) {
        setState({ loading: false, user: null, isAdmin: false });
        return;
      }
      try {
        // Force refresh in case admin was just granted in another tab.
        const tokenResult = await user.getIdTokenResult(true);
        setState({ loading: false, user, isAdmin: tokenResult.claims.admin === true });
      } catch {
        setState({ loading: false, user, isAdmin: false });
      }
    });
  }, []);

  return state;
}

export function signOut() {
  return fbSignOut(firebaseAuth);
}
