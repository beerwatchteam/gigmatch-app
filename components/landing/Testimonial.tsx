import React from 'react';

// TODO: Replace with a real, approved quote before launch. Do not ship this placeholder.
export function Testimonial() {
  return (
    <section
      aria-labelledby="testimonial-label"
      style={{
        backgroundColor: '#ffffff',
        borderTop: '1px solid #e9e2d3',
        borderBottom: '1px solid #e9e2d3',
      }}
    >
      <div className="lp-section-inner lp-section-inner--narrow" style={{ maxWidth: 680 }}>
        <p id="testimonial-label" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
          Testimonial
        </p>
        <blockquote style={{ textAlign: 'center' }}>
          <p style={{
            fontSize: 'clamp(20px, 3vw, 28px)',
            fontWeight: 500,
            lineHeight: 1.45,
            letterSpacing: '-0.015em',
            color: '#17140e',
            marginBottom: 28,
          }}>
            "Finally, a platform that treats booking live music like the professional process it is."
          </p>
          <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#17140e' }}>Placeholder Venue</span>
            <span aria-hidden="true" style={{ fontSize: 14, color: '#948c7a' }}>/</span>
            <span style={{ fontSize: 14, fontWeight: 400, color: '#948c7a' }}>Melbourne, VIC</span>
          </footer>
        </blockquote>
      </div>
    </section>
  );
}
