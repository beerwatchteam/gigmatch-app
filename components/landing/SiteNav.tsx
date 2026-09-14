import React, { useEffect, useRef, useState } from 'react';

const NAV_LINKS = [
  { label: 'For Artists', href: '#artists' },
  { label: 'For Venues', href: '#venues' },
  { label: 'How It Works', href: '#how-it-works' },
];

export function SiteNav() {
  const navRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
          aria-label="GigMatch home"
          style={{ flexShrink: 0, textDecoration: 'none' }}
        >
          <span style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.025em' }}>
            GigMatch
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
        <div className="lp-nav-actions" style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <a
            href="/login"
            className="lp-nav-signin"
            style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.65)', textDecoration: 'none', transition: 'color 0.15s' }}
          >
            Sign In
          </a>
          <a
            href="#get-started"
            className="lp-btn lp-btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
              height: 36,
              padding: '0 16px',
              borderRadius: 6,
              backgroundColor: '#fa830c',
              color: '#ffffff',
              textDecoration: 'none',
              cursor: 'pointer',
              border: 'none',
              minHeight: 36,
              transition: 'background 0.15s',
            }}
          >
            Get Started
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
          {[...NAV_LINKS, { label: 'Sign In', href: '/login' }].map(({ label, href }) => (
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
        <a
          href="#get-started"
          onClick={closeMenu}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            fontWeight: 600,
            height: 48,
            margin: '8px 28px 24px',
            borderRadius: 8,
            backgroundColor: '#fa830c',
            color: '#ffffff',
            textDecoration: 'none',
            cursor: 'pointer',
            border: 'none',
            minHeight: 44,
            transition: 'background 0.15s',
          }}
        >
          Get Started
        </a>
      </div>
    </nav>
  );
}
