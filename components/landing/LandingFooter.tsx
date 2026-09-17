import React from 'react';

export function LandingFooter() {
  return (
    <footer role="contentinfo" style={{ backgroundColor: '#171310' }}>
      <div className="lp-footer-inner" style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '52px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 36,
      }}>
        <div className="lp-footer-top" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 32,
        }}>
          <a
            href="/"
            aria-label="GottaGig home"
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '-0.025em',
              textDecoration: 'none',
            }}
          >
            GottaGig
          </a>
          <nav aria-label="Footer navigation" className="lp-footer-nav" style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            {[
              { label: 'For Artists', href: '#artists' },
              { label: 'For Venues', href: '#venues' },
              { label: 'How It Works', href: '#how-it-works' },
              { label: 'Sign In', href: '/login' },
            ].map(({ label, href }) => (
              <a
                key={href}
                href={href}
                className="lp-footer-link"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'rgba(255,255,255,0.45)',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="lp-footer-bottom" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 24,
          borderTop: '1px solid rgba(255,255,255,0.07)',
          gap: 16,
          flexWrap: 'wrap',
        }}>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', margin: 0 }}>
            &copy; 2026 GottaGig. All rights reserved.
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', margin: 0 }}>
            Built for Australian live music.
          </p>
        </div>
      </div>
    </footer>
  );
}
