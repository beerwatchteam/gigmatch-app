import React from 'react';
import { PROBLEMS, PROBLEM_SECTION_HEADING } from '@/constants/copy';

// Icons paired with each problem card by index
const ICONS = [
  () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
      <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  ),
  () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
];

export function ProblemGrid() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="problem-heading"
      style={{
        backgroundColor: '#ffffff',
        borderTop: '1px solid #e9e2d3',
        borderBottom: '1px solid #e9e2d3',
      }}
    >
      <div className="lp-section-inner" style={{ maxWidth: 1200, margin: '0 auto', padding: '96px 32px' }}>
        <p style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#fa830c',
          marginBottom: 16,
        }}>
          The Problem
        </p>
        <h2
          id="problem-heading"
          style={{
            fontSize: 'clamp(28px, 4vw, 44px)',
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: '-0.025em',
            color: '#17140e',
            marginBottom: 56,
            maxWidth: 520,
          }}
        >
          {PROBLEM_SECTION_HEADING}
        </h2>

        {/* Hairline seams via container background-color gap trick */}
        <div
          className="lp-problem-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1,
            backgroundColor: '#e9e2d3',
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {PROBLEMS.map(({ title, bullets }, idx) => {
            const Icon = ICONS[idx];
            return (
            <div
              key={title}
              className="lp-problem-card"
              style={{
                backgroundColor: '#ffffff',
                padding: '44px 40px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div aria-hidden="true" style={{
                width: 40,
                height: 40,
                backgroundColor: '#faf7f2',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#5b5548',
                flexShrink: 0,
              }}>
                <Icon />
              </div>
              <h3 style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#17140e',
                letterSpacing: '-0.015em',
                margin: 0,
              }}>
                {title}
              </h3>
              <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {bullets.map((point) => (
                  <li key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#fa830c', flexShrink: 0, marginTop: 7 }} />
                    <span style={{ fontSize: 15, fontWeight: 400, lineHeight: 1.7, color: '#5b5548' }}>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ); })}
        </div>
      </div>
    </section>
  );
}
