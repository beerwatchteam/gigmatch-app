import React, { useEffect } from 'react';
import { AnnouncementBar } from './AnnouncementBar';
import { SiteNav } from './SiteNav';
import { Hero } from './Hero';
import { ProblemGrid } from './ProblemGrid';
import { AudienceSplit } from './AudienceSplit';
import { Testimonial } from './Testimonial';
import { LandingFooter } from './LandingFooter';

/*
  Global CSS for the landing page.
  Handles things that can't be done with inline styles:
  keyframe animations, :hover states, media queries, transitions.
  All content is static — no user data is interpolated here.
*/
const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }

  body {
    font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    overflow-x: hidden;
  }
  img, svg { display: block; max-width: 100%; }
  a { color: inherit; text-decoration: none; }
  ul[role="list"] { list-style: none; }

  @keyframes lp-pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.55; transform: scale(0.8); }
  }
  @media (prefers-reduced-motion: reduce) {
    .lp-badge-dot { animation: none !important; }
  }

  /* Focus */
  a:focus-visible, button:focus-visible {
    outline: 2px solid #fa830c;
    outline-offset: 3px;
  }

  /* Hover states */
  .lp-btn-primary:hover  { background-color: #e07200 !important; }
  .lp-btn-ghost:hover    { background-color: rgba(255,255,255,0.14) !important; color: #fff !important; border-color: rgba(255,255,255,0.25) !important; }
  .lp-btn-outline:hover  { border-color: #17140e !important; }
  .lp-btn-accent:hover   { background-color: #e07200 !important; }
  .lp-nav-link:hover     { color: #ffffff !important; }
  .lp-nav-signin:hover   { color: #ffffff !important; }
  .lp-footer-link:hover  { color: rgba(255,255,255,0.85) !important; }
  .lp-bar-link:hover     { color: #ffb347 !important; }
  .lp-mobile-link:hover  { color: #ffffff !important; }

  /* Nav scroll state */
  .lp-nav { transition: background 0.25s ease, backdrop-filter 0.25s ease, box-shadow 0.25s ease; }
  .lp-nav.lp-nav-scrolled {
    background: rgba(23,19,16,0.88) !important;
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(12px) !important;
    box-shadow: 0 1px 0 rgba(255,255,255,0.05) !important;
  }

  /* Mobile menu slide */
  .lp-mobile-menu {
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.3s ease;
  }
  .lp-mobile-menu.is-open { max-height: 440px; }

  /* ── Responsive ───────────────────────────────────────────── */

  /* Collapse nav at 860px */
  @media (max-width: 860px) {
    .lp-nav-links   { display: none !important; }
    .lp-nav-actions { display: none !important; }
    .lp-nav-menu-btn { display: flex !important; }
    .lp-problem-grid { grid-template-columns: 1fr !important; }
    .lp-audience-grid { grid-template-columns: 1fr !important; }
    .lp-stat-divider  { display: none !important; }
    .lp-hero-stats {
      flex-wrap: wrap !important;
      justify-content: center !important;
      gap: 24px !important;
    }
    .lp-stat-tile { flex: 0 0 calc(50% - 12px) !important; }
  }

  @media (max-width: 780px) {
    .lp-section-inner { padding: 72px 24px !important; }
    .lp-hero-content  { padding: 72px 24px !important; }
    .lp-audience-card { padding: 40px 32px !important; }
    .lp-problem-card  { padding: 36px 32px !important; }
  }

  @media (max-width: 400px) {
    .lp-bar-text { font-size: 11px !important; }
    .lp-hero-ctas { flex-direction: column !important; width: 100% !important; }
    .lp-hero-ctas a { width: 100% !important; text-align: center !important; }
    .lp-stat-tile { flex: 0 0 100% !important; }
    .lp-footer-top { flex-direction: column !important; align-items: flex-start !important; }
    .lp-footer-nav { gap: 16px !important; flex-wrap: wrap !important; }
    .lp-footer-bottom { flex-direction: column !important; align-items: flex-start !important; }
  }
`;

export function LandingPage() {
  // Inject global CSS into <head> — reliable in all Expo web environments.
  // All content is static; no user data is interpolated.
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);

  return (
    <div style={{ backgroundColor: '#faf7f2', minHeight: '100vh' }}>
        <AnnouncementBar />
        <SiteNav />
        <main>
          <Hero />
          <ProblemGrid />
          <AudienceSplit />
          <Testimonial />
        </main>
        <LandingFooter />
      </div>
  );
}
