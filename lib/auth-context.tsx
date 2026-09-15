import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export type UserProfile = {
  type: 'venue' | 'artist' | 'admin' | 'agent';
  displayName: string;
  venueId?: string;
  username?: string;
  uid: string;
  claimStatus?: 'pending' | 'awaiting_code' | 'manual_review' | 'approved';
};

type AuthContextType = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | undefined;
    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = undefined; }
      setUser(firebaseUser);
      if (firebaseUser) {
        unsubProfile = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (snap) => {
            setProfile(snap.exists() ? { uid: firebaseUser.uid, ...snap.data() } as UserProfile : null);
            setLoading(false);
          },
          () => { setProfile(null); setLoading(false); },
        );
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => { unsubAuth(); if (unsubProfile) unsubProfile(); };
  }, []);

  const isAdmin = profile?.type === 'admin' ||
    user?.email === 'beerwatchbusiness@gmail.com';

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
