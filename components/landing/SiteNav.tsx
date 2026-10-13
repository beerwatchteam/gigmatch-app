import React, { useEffect, useRef, useState } from 'react';
import { signInWithEmailAndPassword, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { getDocs, query, collection, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

const NAV_LINKS = [
  { label: 'For Artists', href: '#artists' },
  { label: 'For Venues', href: '#venues' },
  { label: 'How It Works', href: '#how-it-works' },
];

const DEMO_ACCOUNTS = {
  artist: { username: 'twayloartist', password: 'twayloartist' },
  venue:  { username: 'twaylovenue',  password: 'twaylovenue'  },
} as const;

async function resolveUsernameToEmail(username: string): Promise<string | null> {
  const lower = username.toLowerCase();
  const [bpSnap, uSnap] = await Promise.all([
    getDocs(query(collection(db, 'bandProfiles'), where('username', '==', lower))),
    getDocs(query(collection(db, 'users'),        where('username', '==', lower))),
  ]);
  if (!bpSnap.empty) return (bpSnap.docs[0].data().email as string) || null;
  if (!uSnap.empty && uSnap.docs[0].data().email) return uSnap.docs[0].data().email as string;
  return null;
}

export function SiteNav() {
  const navRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingRole, setLoadingRole] = useState<'artist' | 'venue' | null>(null);

  // Attach scroll class directly via DOM ref — no re-renders
  useEffect(() => {
    function onScroll() {
      navRef.current?.classList.toggle('lp-nav-scrolled', window.scrollY > 10);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function toggleMenu() {
    setMenuOpen((prev) => !prev);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  async function handleDemoLogin(role: 'artist' | 'venue') {
    if (loadingRole) return;
    setLoadingRole(role);
    try {
      const { username, password } = DEMO_ACCOUNTS[role];
      const email = await resolveUsernameToEmail(username);
      if (!email) return;
      await setPersistence(auth, browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, password);
      window.location.href = '/';
    } catch {
      // silent — user stays on landing page
    } finally {
      setLoadingRole(null);
    }
  }

  return (
    <nav
      ref={navRef}
      className="lp-nav"
      aria-label="Main navigation"
      style={{
        position: 'sticky',
        top: 40,
        zIndex: 99,
        backgroundColor: 'transparent',
      }}
    >
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '0 32px',
        height: 76,
        display: 'flex',
        alignItems: 'center',
        gap: 40,
      }}>
        {/* Logo */}
        <a
          href="/"
          aria-label="Twaylo home"
          style={{ flexShrink: 0, textDecoration: 'none' }}
        >
          <span style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.025em' }}>
            Twaylo Gigs
          </span>
        </a>

        {/* Desktop links */}
        <ul
          role="list"
          className="lp-nav-links"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            listStyle: 'none',
            margin: 0,
            padding: 0,
            flex: 1,
          }}
        >
          {NAV_LINKS.map(({ label, href }) => (
            <li key={href}>
              <a
                href={href}
                className="lp-nav-link"
                style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.65)', textDecoration: 'none', transition: 'color 0.15s' }}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>

        {/* Desktop actions */}
        <div className="lp-nav-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => handleDemoLogin('artist')}
            disabled={loadingRole !== null}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
              height: 34,
              padding: '0 14px',
              borderRadius: 6,
              backgroundColor: 'transparent',
              color: 'rgba(255,255,255,0.75)',
              border: '1px solid rgba(255,255,255,0.25)',
              cursor: loadingRole ? 'default' : 'pointer',
              opacity: loadingRole === 'artist' ? 0.6 : 1,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {loadingRole === 'artist' ? 'Loading...' : 'View as Artist'}
          </button>
          <button
            onClick={() => handleDemoLogin('venue')}
            disabled={loadingRole !== null}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
              height: 34,
              padding: '0 14px',
              borderRadius: 6,
              backgroundColor: '#fa830c',
              color: '#ffffff',
              border: 'none',
              cursor: loadingRole ? 'default' : 'pointer',
              opacity: loadingRole === 'venue' ? 0.6 : 1,
              transition: 'background 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {loadingRole === 'venue' ? 'Loading...' : 'View as Venue'}
          </button>
          <a
            href="/login"
            className="lp-nav-signin"
            style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', transition: 'color 0.15s', marginLeft: 4, whiteSpace: 'nowrap' }}
          >
            Log In
          </a>
        </div>

        {/* Hamburger */}
        <button
          className="lp-nav-menu-btn"
          onClick={toggleMenu}
          aria-expanded={menuOpen}
          aria-controls="lp-mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          style={{
            display: 'none',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 5,
            width: 44,
            height: 44,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginLeft: 'auto',
            flexShrink: 0,
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                display: 'block',
                width: 22,
                height: 1.5,
                backgroundColor: 'rgba(255,255,255,0.8)',
                borderRadius: 2,
              }}
            />
          ))}
        </button>
      </div>

      {/* Mobile menu */}
      <div
        id="lp-mobile-menu"
        className={`lp-mobile-menu${menuOpen ? ' is-open' : ''}`}
        aria-hidden={!menuOpen}
        style={{
          backgroundColor: '#171310',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: '8px 0' }}>
          {[...NAV_LINKS, { label: 'Log In', href: '/login' }].map(({ label, href }) => (
            <li key={href}>
              <a
                href={href}
                onClick={closeMenu}
                className="lp-mobile-link"
                style={{
                  display: 'block',
                  padding: '14px 28px',
                  fontSize: 16,
                  fontWeight: 500,
                  color: 'rgba(255,255,255,0.7)',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div style={{ margin: '8px 28px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={() => { closeMenu(); handleDemoLogin('artist'); }}
            disabled={loadingRole !== null}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 600, height: 48, borderRadius: 8,
              backgroundColor: 'transparent', color: 'rgba(255,255,255,0.8)',
              border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer',
              opacity: loadingRole === 'artist' ? 0.6 : 1,
            }}
          >
            {loadingRole === 'artist' ? 'Loading...' : 'View as Artist'}
          </button>
          <button
            onClick={() => { closeMenu(); handleDemoLogin('venue'); }}
            disabled={loadingRole !== null}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 600, height: 48, borderRadius: 8,
              backgroundColor: '#fa830c', color: '#ffffff',
              border: 'none', cursor: 'pointer',
              opacity: loadingRole === 'venue' ? 0.6 : 1,
            }}
          >
            {loadingRole === 'venue' ? 'Loading...' : 'View as Venue'}
          </button>
        </div>
      </div>
    </nav>
  );
}
