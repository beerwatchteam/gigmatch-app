import React, { useEffect, useRef } from 'react';
import { HERO_HEADLINE, HERO_HEADLINE_LINE2, HERO_SUBHEAD, HERO_STATS } from '@/constants/copy';

// Equaliser waveform silhouette — jagged polygon that looks like music eq bars
const EQ_CLIP_PATH = `polygon(
  0% 100%, 0% 65%, 4% 65%, 4% 38%, 8% 38%, 8% 60%, 12% 60%, 12% 22%,
  16% 22%, 16% 50%, 20% 50%, 20% 12%, 24% 12%, 24% 42%, 28% 42%, 28% 68%,
  32% 68%, 32% 28%, 36% 28%, 36% 55%, 40% 55%, 40% 18%, 44% 18%, 44% 46%,
  48% 46%, 48% 74%, 52% 74%, 52% 30%, 56% 30%, 56% 56%, 60% 56%, 60% 14%,
  64% 14%, 64% 44%, 68% 44%, 68% 66%, 72% 66%, 72% 24%, 76% 24%, 76% 52%,
  80% 52%, 80% 78%, 84% 78%, 84% 36%, 88% 36%, 88% 58%, 92% 58%, 92% 20%,
  96% 20%, 96% 48%, 100% 48%, 100% 100%
)`;

// Copy imported from constants/copy.ts

export function Hero() {
  const heroRef    = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const glowRef    = useRef<HTMLDivElement>(null);
  const eqRef      = useRef<HTMLDivElement>(null);
  const visualRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Reduced-motion: render resting state, attach no listener
    if (reduced) {
      if (contentRef.current) {
        contentRef.current.style.opacity = '1';
        contentRef.current.style.transform = 'translateY(0px)';
      }
      if (glowRef.current)   glowRef.current.style.opacity = '1';
      if (eqRef.current)     eqRef.current.style.opacity = '0.55';
      if (visualRef.current) visualRef.current.style.transform = 'translateY(0px)';
      return;
    }

    let rafId: number | null = null;

    function update() {
      rafId = null;
      const hero = heroRef.current;
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const h = hero.offsetHeight;
      if (!h) return;

      /*
        progress: 0 at hero top, 1 when hero has scrolled fully past viewport.
        Content fades over the first 65% of that range so it's fully gone
        before it could clip under the pinned bar + nav.
      */
      const p    = Math.max(0, Math.min(1, -rect.top / h));
      const fade = Math.min(p / 0.65, 1);

      if (contentRef.current) {
        contentRef.current.style.opacity   = (1 - fade).toFixed(4);
        contentRef.current.style.transform = `translateY(${(-fade * 26).toFixed(2)}px)`;
      }
      if (glowRef.current) {
        glowRef.current.style.opacity = (1 - p * 0.6).toFixed(4);
      }
      if (eqRef.current) {
        eqRef.current.style.opacity = Math.min(p * 1.3, 0.85).toFixed(4);
      }
      if (visualRef.current) {
        // Parallax: visual layer moves slower than scroll
        visualRef.current.style.transform = `translateY(${(p * 40).toFixed(2)}px)`;
      }
    }

    function schedule() {
      if (rafId === null) rafId = requestAnimationFrame(update);
    }

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    update(); // initial paint

    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <section
      ref={heroRef}
      aria-label="Hero"
      style={{
        position: 'relative',
        minHeight: 640,
        backgroundColor: '#171310',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Visual layers — decorative, hidden from assistive tech */}
      <div
        ref={visualRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          willChange: 'transform',
        }}
      >
        {/* Stage glow — spotlight from below */}
        <div
          ref={glowRef}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse 75% 55% at 50% 108%, rgba(250,131,12,0.5) 0%, rgba(250,131,12,0.12) 50%, transparent 70%)',
            willChange: 'opacity',
          }}
        />

        {/* Ambient diagonal light beams — static */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: `
            linear-gradient(138deg, rgba(250,131,12,0.05) 0%, transparent 42%),
            linear-gradient(218deg, rgba(250,131,12,0.04) 0%, transparent 42%)
          `,
        }} />

        {/* Equaliser dot-matrix clipped to waveform silhouette */}
        <div
          ref={eqRef}
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle, rgba(250,131,12,0.55) 1.5px, transparent 1.5px)',
            backgroundSize: '18px 18px',
            clipPath: EQ_CLIP_PATH,
            opacity: 0,
            willChange: 'opacity',
          }}
        />
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          padding: '96px 32px',
          willChange: 'opacity, transform',
        }}
        className="lp-hero-content"
      >
        <div style={{
          maxWidth: 720,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 24,
        }}>
          {/* Live badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: 'rgba(250,131,12,0.1)',
            border: '1px solid rgba(250,131,12,0.28)',
            borderRadius: 100,
            padding: '6px 14px',
          }}>
            <span
              className="lp-badge-dot"
              style={{
                width: 7,
                height: 7,
                backgroundColor: '#fa830c',
                borderRadius: '50%',
                flexShrink: 0,
                animation: 'lp-pulse-dot 2.2s ease-in-out infinite',
              }}
            />
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#fa830c',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              Live in Melbourne, Sydney &amp; Brisbane
            </span>
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize: 'clamp(40px, 7.5vw, 76px)',
            fontWeight: 900,
            lineHeight: 1.04,
            letterSpacing: '-0.035em',
            color: '#ffffff',
            margin: 0,
          }}>
            {HERO_HEADLINE}<br />{HERO_HEADLINE_LINE2}
          </h1>

          {/* Subhead */}
          <p style={{
            fontSize: 'clamp(16px, 2.2vw, 20px)',
            fontWeight: 400,
            lineHeight: 1.65,
            color: 'rgba(255,255,255,0.6)',
            maxWidth: 540,
            margin: 0,
          }}>
            {HERO_SUBHEAD}
          </p>

          {/* CTAs */}
          <div className="lp-hero-ctas" style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
            marginTop: 4,
          }}>
            <a
              href="#get-started"
              id="get-started"
              className="lp-btn lp-btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 600,
                height: 52,
                padding: '0 32px',
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
            <a
              href="/login?mode=signup&tab=artist"
              className="lp-btn lp-btn-ghost"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 600,
                height: 52,
                padding: '0 32px',
                borderRadius: 8,
                backgroundColor: 'rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(255,255,255,0.15)',
                textDecoration: 'none',
                cursor: 'pointer',
                minHeight: 44,
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
            >
              Sign Up
            </a>
          </div>

          {/* Stat tiles */}
          <div className="lp-hero-stats" style={{
            display: 'flex',
            alignItems: 'flex-start',
            width: '100%',
            maxWidth: 580,
            marginTop: 20,
            paddingTop: 32,
            borderTop: '1px solid rgba(255,255,255,0.07)',
          }}>
            {HERO_STATS.map(({ num, label }, i) => (
              <React.Fragment key={label}>
                {i > 0 && (
                  <div
                    className="lp-stat-divider"
                    aria-hidden="true"
                    style={{ width: 1, height: 44, backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0, alignSelf: 'center' }}
                  />
                )}
                <div className="lp-stat-tile" style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 7,
                  padding: '0 12px',
                  textAlign: 'center',
                }}>
                  <span style={{
                    fontSize: 'clamp(28px, 4vw, 40px)',
                    fontWeight: 900,
                    color: '#fa830c',
                    letterSpacing: '-0.035em',
                    lineHeight: 1,
                  }}>
                    {num}
                  </span>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'rgba(255,255,255,0.38)',
                    lineHeight: 1.45,
                    letterSpacing: '0.01em',
                  }}>
                    {label}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
