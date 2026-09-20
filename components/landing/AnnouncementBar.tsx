import React from 'react';

export function AnnouncementBar() {
  return (
    <div
      role="banner"
      aria-label="Announcement"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backgroundColor: '#171310',
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 20px',
      }}
    >
      <p className="lp-bar-text" style={{
        fontSize: 12,
        fontWeight: 500,
        color: 'rgba(255,255,255,0.65)',
        letterSpacing: '0.01em',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        margin: 0,
      }}>
        Twaylo is now live: Australian venues are publishing real gig slots.{' '}
        <a href="#get-started" className="lp-bar-link" style={{ color: '#fa830c', fontWeight: 600 }}>
          Find yours
        </a>
      </p>
    </div>
  );
}
