import React from 'react';

const ARTIST_FEATURES = [
  'Browse venues with real open slots on their timetable',
  'Send a structured enquiry in minutes, not a cold DM',
  'Track every booking from one inbox and always know where you stand',
];

const VENUE_FEATURES = [
  'Publish your timetable once and receive quality enquiries',
  'Accept or decline with one tap and the artist is notified instantly',
  'All artist conversations in one thread, no lost messages',
];

function FeatureList({ features, dark }: { features: string[]; dark: boolean }) {
  return (
    <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
      {features.map((text) => (
        <li key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span
            aria-hidden="true"
            style={{ fontSize: 15, fontWeight: 700, color: '#fa830c', flexShrink: 0, lineHeight: 1.55, marginTop: 1 }}
          >
            &#x2192;
          </span>
          <span style={{
            fontSize: 15,
            fontWeight: 400,
            lineHeight: 1.55,
            color: dark ? 'rgba(255,255,255,0.55)' : '#5b5548',
          }}>
            {text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AudienceSplit() {
  return (
    <section aria-labelledby="audience-heading" style={{ backgroundColor: '#faf7f2' }}>
      <div className="lp-section-inner" style={{ maxWidth: 1200, margin: '0 auto', padding: '96px 32px' }}>
        <h2 id="audience-heading" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', margin: -1 }}>
          GigMatch for Artists and Venues
        </h2>

        <div className="lp-audience-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Artists card — light */}
          <div
            id="artists"
            className="lp-audience-card"
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e9e2d3',
              borderRadius: 16,
              padding: '52px 48px',
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#948c7a' }}>
              For Artists
            </span>
            <h3 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.025em', color: '#17140e', margin: 0 }}>
              Find stages worth playing.
            </h3>
            <FeatureList features={ARTIST_FEATURES} dark={false} />
            <a
              href="#get-started"
              className="lp-btn lp-btn-outline"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 15,
                fontWeight: 600,
                height: 48,
                padding: '0 24px',
                borderRadius: 8,
                border: '1.5px solid #e9e2d3',
                backgroundColor: 'transparent',
                color: '#17140e',
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'border-color 0.15s',
                alignSelf: 'flex-start',
                minHeight: 44,
              }}
            >
              Browse Venues
            </a>
          </div>

          {/* Venues card — dark (visual priority) */}
          <div
            id="venues"
            className="lp-audience-card"
            style={{
              backgroundColor: '#1e1a14',
              borderRadius: 16,
              padding: '52px 48px',
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#fa830c' }}>
              For Venues
            </span>
            <h3 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.025em', color: '#ffffff', margin: 0 }}>
              Fill your calendar, not your inbox.
            </h3>
            <FeatureList features={VENUE_FEATURES} dark={true} />
            <a
              href="/login?mode=signup&tab=venue"
              className="lp-btn lp-btn-accent"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 15,
                fontWeight: 600,
                height: 48,
                padding: '0 24px',
                borderRadius: 8,
                backgroundColor: '#fa830c',
                color: '#ffffff',
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'background 0.15s',
                alignSelf: 'flex-start',
                minHeight: 44,
                border: 'none',
              }}
            >
              List Your Venue
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
