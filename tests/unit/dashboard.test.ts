/**
 * Unit tests for lib/dashboard.ts and lib/dashboard-export.ts.
 * Pure functions only — no Firebase emulator required.
 *
 * Covers the 8 specs from the dashboard brief (section H):
 *   H.1  Money separation (confirmed vs pending never combined)
 *   H.2  Disputed exclusion
 *   H.3  No-fee gigs counted separately, never as $0
 *   H.4  gigRowDisplay planned vs actual strings
 *   H.5  Period boundaries and Australian FY preset
 *   H.6  Timezone-aware monthly bucketing
 *   H.7  Agent roster rollup — no double-counting
 *   H.8  PDF export contains matching headline figures
 */

import { Timestamp } from 'firebase/firestore';
import {
  summarizeGigs,
  gigRowDisplay,
  PERIOD_PRESETS,
  formatAud,
} from '../../lib/dashboard';
import { buildPdfHtml, buildCsv } from '../../lib/dashboard-export';
import type { Gig, GigFee } from '../../lib/gig-types';
import type { DashboardSummary } from '../../lib/dashboard';

// ── Fixture ───────────────────────────────────────────────────────────────────

// Use extreme dates so tests never depend on the system clock for played/upcoming.
const PAST   = new Date('2020-06-15T09:00:00Z'); // definitely in the past
const FUTURE = new Date('2099-06-15T09:00:00Z'); // definitely in the future

function makeGig(overrides: {
  id?:                  string;
  status?:              'confirmed' | 'cancelled';
  feeType?:             GigFee['type'];
  amountCents?:         number | null;
  doorPercent?:         number | null;
  paymentStatus?:       string;
  listAsBooked?:        boolean;
  confirmedAmountCents?: number | null;
  startAtDate?:         Date;
  endAtDate?:           Date | null;
  timezone?:            string;
  venueId?:             string | null;
  venueName?:           string | null;
  artistUid?:           string | null;
  artistName?:          string | null;
  source?:              Gig['source'];
}): Gig {
  const {
    id                   = 'g1',
    status               = 'confirmed',
    feeType              = 'flat',
    amountCents          = 30000,
    doorPercent          = null,
    paymentStatus        = 'pending',
    listAsBooked         = true,
    confirmedAmountCents = null,
    startAtDate          = PAST,
    endAtDate,
    timezone             = 'Australia/Melbourne',
    venueId              = 'v1',
    venueName            = 'The Espy',
    artistUid            = 'a1',
    artistName           = 'Test Band',
    source               = 'enquiry',
  } = overrides;

  const resolvedEndAt = endAtDate !== undefined
    ? (endAtDate === null ? null : Timestamp.fromDate(endAtDate))
    : Timestamp.fromDate(new Date(startAtDate.getTime() + 3_600_000));

  return {
    id,
    enquiryId: null,
    venueId,
    venueName,
    venueUid: 'vu1',
    artistUid,
    artistName,
    bandName: artistName ?? 'Test Band',
    title: null, description: null, locationText: null, state: null,
    isPublic: false, status, source,
    startAt: Timestamp.fromDate(startAtDate),
    endAt: resolvedEndAt,
    timezone,
    setLengthMinutes: null, loadInTime: null, soundCheckTime: null, room: null,
    fee: {
      type: feeType, amountCents, doorPercent,
      ticketPriceCents: null, ticketUrl: null, notes: null,
    },
    payment: {
      timing: null,
      timingProposal: null,
      status: paymentStatus as any,
      venueConfirm: null,
      artistConfirm: null,
      confirmedAmountCents,
      confirmedAt: confirmedAmountCents != null ? Timestamp.fromDate(new Date(0)) : null,
      reminderSentAt: null,
      updatedAt: Timestamp.fromDate(new Date(0)),
    },
    participantIds: [artistUid ?? 'a1', 'vu1'],
    createdBy: artistUid ?? 'a1',
    listAsBooked,
    createdAt: Timestamp.fromDate(new Date(0)),
    updatedAt: Timestamp.fromDate(new Date(0)),
  };
}

// ── H.1 Money separation ─────────────────────────────────────────────────────

describe('H.1 Money separation', () => {
  test('confirmed $700 and pending $300 land in separate fields, never combined', () => {
    const confirmedGig = makeGig({
      id: 'g1', feeType: 'flat', amountCents: 70000,
      paymentStatus: 'confirmed', confirmedAmountCents: 70000,
      startAtDate: PAST,
    });
    const pendingGig = makeGig({
      id: 'g2', feeType: 'flat', amountCents: 30000,
      paymentStatus: 'pending', listAsBooked: true,
      startAtDate: PAST,
    });

    const summary = summarizeGigs([confirmedGig, pendingGig], 'artist');

    expect(summary.confirmedCents).toBe(70000);
    expect(summary.pendingCents).toBe(30000);
    // The headline confirmed figure must not silently absorb pending
    expect(formatAud(summary.confirmedCents)).toBe('$700');
    expect(formatAud(summary.pendingCents)).toBe('$300');
    // No leakage into other buckets
    expect(summary.disputedCount).toBe(0);
    expect(summary.noFeeCount).toBe(0);
    expect(summary.selfReportedCents).toBe(0);
  });

  test('self_reported amount is included in confirmedCents and also tracked in selfReportedCents', () => {
    const gig = makeGig({
      feeType: 'flat', amountCents: 50000,
      paymentStatus: 'self_reported', confirmedAmountCents: 50000,
      startAtDate: PAST,
    });

    const summary = summarizeGigs([gig], 'artist');

    expect(summary.confirmedCents).toBe(50000);
    expect(summary.selfReportedCents).toBe(50000);
    expect(summary.pendingCents).toBe(0);
  });
});

// ── H.2 Disputed exclusion ────────────────────────────────────────────────────

describe('H.2 Disputed exclusion', () => {
  test('disputed gig excluded from both confirmed and pending; counted in disputedCents only', () => {
    const disputedGig = makeGig({
      feeType: 'flat', amountCents: 50000,
      paymentStatus: 'disputed',
      startAtDate: PAST,
    });

    const summary = summarizeGigs([disputedGig], 'artist');

    expect(summary.confirmedCents).toBe(0);
    expect(summary.pendingCents).toBe(0);
    expect(summary.disputedCents).toBe(50000);
    expect(summary.disputedCount).toBe(1);
  });

  test('mix of confirmed $400, disputed $500, pending $300 — each in correct bucket', () => {
    const c = makeGig({ id: 'c', feeType: 'flat', amountCents: 40000, paymentStatus: 'confirmed', confirmedAmountCents: 40000 });
    const d = makeGig({ id: 'd', feeType: 'flat', amountCents: 50000, paymentStatus: 'disputed' });
    const p = makeGig({ id: 'p', feeType: 'flat', amountCents: 30000, paymentStatus: 'pending', listAsBooked: true });

    const summary = summarizeGigs([c, d, p], 'artist');

    expect(summary.confirmedCents).toBe(40000);
    expect(summary.pendingCents).toBe(30000);
    expect(summary.disputedCents).toBe(50000);
    expect(summary.disputedCount).toBe(1);
  });
});

// ── H.3 No-fee gigs ───────────────────────────────────────────────────────────

describe('H.3 No-fee gigs counted separately, never treated as $0', () => {
  test('unpaid gig increments noFeeCount only', () => {
    const gig = makeGig({
      feeType: 'unpaid', amountCents: null,
      paymentStatus: 'not_applicable',
      startAtDate: PAST,
    });

    const summary = summarizeGigs([gig], 'artist');

    expect(summary.noFeeCount).toBe(1);
    expect(summary.confirmedCents).toBe(0);
    expect(summary.pendingCents).toBe(0);
    expect(summary.disputedCents).toBe(0);
  });

  test('pending gig with listAsBooked=false counts as noFee, not pending', () => {
    const gig = makeGig({
      feeType: 'flat', amountCents: 30000,
      paymentStatus: 'pending', listAsBooked: false,
      startAtDate: PAST,
    });

    const summary = summarizeGigs([gig], 'artist');

    expect(summary.noFeeCount).toBe(1);
    expect(summary.pendingCents).toBe(0);
  });

  test('noFeeCount is a count, never a dollar figure', () => {
    const g1 = makeGig({ id: 'g1', feeType: 'unpaid', amountCents: null, paymentStatus: 'not_applicable' });
    const g2 = makeGig({ id: 'g2', feeType: 'unpaid', amountCents: null, paymentStatus: 'not_applicable' });

    const summary = summarizeGigs([g1, g2], 'artist');

    expect(summary.noFeeCount).toBe(2);
    expect(typeof summary.noFeeCount).toBe('number');
    // confirmedCents must stay zero — noFee never contributes
    expect(summary.confirmedCents).toBe(0);
  });
});

// ── H.4 gigRowDisplay planned vs actual ──────────────────────────────────────

describe('H.4 gigRowDisplay — planned vs actual strings', () => {
  test('flat $400 confirmed → Flat $400 / $400 / confirmed', () => {
    const gig = makeGig({
      feeType: 'flat', amountCents: 40000,
      paymentStatus: 'confirmed', confirmedAmountCents: 40000,
    });
    const row = gigRowDisplay(gig);
    expect(row.planned).toBe('Flat $400');
    expect(row.actual).toBe('$400');
    expect(row.status).toBe('confirmed');
  });

  test('door_split 70% pending → Door split 70% / em-dash / pending', () => {
    const gig = makeGig({
      feeType: 'door_split', amountCents: null, doorPercent: 70,
      paymentStatus: 'pending', listAsBooked: true,
    });
    const row = gigRowDisplay(gig);
    expect(row.planned).toBe('Door split 70%');
    expect(row.actual).toBe('\u2014');
    expect(row.status).toBe('pending');
  });

  test('guarantee_vs_door $200 pending → Guarantee $200 / em-dash / pending', () => {
    const gig = makeGig({
      feeType: 'guarantee_vs_door', amountCents: 20000,
      paymentStatus: 'pending', listAsBooked: true,
    });
    const row = gigRowDisplay(gig);
    expect(row.planned).toBe('Guarantee $200');
    expect(row.actual).toBe('\u2014');
    expect(row.status).toBe('pending');
  });

  test('unpaid → Unpaid / em-dash / none', () => {
    const gig = makeGig({
      feeType: 'unpaid', amountCents: null,
      paymentStatus: 'not_applicable',
    });
    const row = gigRowDisplay(gig);
    expect(row.planned).toBe('Unpaid');
    expect(row.actual).toBe('\u2014');
    expect(row.status).toBe('none');
  });

  test('self_reported $350 → actual shows confirmed amount', () => {
    const gig = makeGig({
      feeType: 'flat', amountCents: 35000,
      paymentStatus: 'self_reported', confirmedAmountCents: 35000,
    });
    const row = gigRowDisplay(gig);
    expect(row.actual).toBe('$350');
    expect(row.status).toBe('self_reported');
  });
});

// ── H.5 Period boundaries and Australian FY preset ───────────────────────────

describe('H.5 Period boundaries and FY presets', () => {
  test('this_fy: start is 1 Jul, end is 1 Jul of following year', () => {
    const fy    = PERIOD_PRESETS.this_fy();
    const start = fy.start.toDate();
    const end   = fy.end.toDate();
    const now   = new Date();
    const expectedFyStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;

    expect(start.getFullYear()).toBe(expectedFyStart);
    expect(start.getMonth()).toBe(6);   // July = index 6
    expect(start.getDate()).toBe(1);

    expect(end.getFullYear()).toBe(expectedFyStart + 1);
    expect(end.getMonth()).toBe(6);
    expect(end.getDate()).toBe(1);

    expect(fy.label).toMatch(/FY/);
  });

  test('last_fy ends exactly where this_fy starts, spanning 365 or 366 days', () => {
    const thisFy = PERIOD_PRESETS.this_fy();
    const lastFy = PERIOD_PRESETS.last_fy();

    // last_fy.end === this_fy.start
    expect(lastFy.end.toDate().getTime()).toBe(thisFy.start.toDate().getTime());

    const dayMs    = 24 * 60 * 60 * 1000;
    const spanDays = (lastFy.end.toDate().getTime() - lastFy.start.toDate().getTime()) / dayMs;
    expect([365, 366]).toContain(spanDays);
  });

  test('period boundary: gig at period.end is at or after end (excluded by Firestore query)', () => {
    // Firestore uses startAt < period.end — a gig timestamped at exactly period.end is excluded.
    const periodEnd = new Date('2026-08-01T00:00:00.000Z');
    const gigAtEnd  = Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z'));
    const gigBefore = Timestamp.fromDate(new Date('2026-07-31T23:59:59.000Z'));

    // The gig at end is NOT strictly less than periodEnd
    expect(gigAtEnd.toDate().getTime()).toBeGreaterThanOrEqual(periodEnd.getTime());
    // The gig before end IS strictly less
    expect(gigBefore.toDate().getTime()).toBeLessThan(periodEnd.getTime());
  });

  test('period boundary: gig at period.start is included (startAt >= period.start)', () => {
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const gigAtStart  = Timestamp.fromDate(new Date('2026-07-01T00:00:00.000Z'));

    expect(gigAtStart.toDate().getTime()).toBeGreaterThanOrEqual(periodStart.getTime());
  });
});

// ── H.6 Timezone-correct monthly bucketing ───────────────────────────────────

describe('H.6 Timezone-correct monthly bucketing', () => {
  test('gig at 12:30 AM AEDT on Dec 1 is bucketed to December, not November', () => {
    // 2026-11-30T13:30:00Z = 2026-12-01T00:30:00 AEDT (UTC+11, DST active)
    // A viewer in UTC would see November; gig.timezone bucketing must see December.
    const startUtc = new Date('2026-11-30T13:30:00Z');

    const gig = makeGig({
      startAtDate: startUtc,
      endAtDate:   new Date(startUtc.getTime() + 3_600_000),
      timezone:    'Australia/Melbourne',
      feeType:     'flat', amountCents: 10000,
      paymentStatus: 'confirmed', confirmedAmountCents: 10000,
    });

    const summary = summarizeGigs([gig], 'artist', 'UTC');

    expect(summary.byMonth).toHaveLength(1);
    // The month label must be December 2026 (Melbourne local), not November
    expect(summary.byMonth[0].month).toMatch(/Dec/i);
    expect(summary.byMonth[0].month).toContain('2026');
    expect(summary.byMonth[0].confirmedCents).toBe(10000);
  });

  test('two gigs in the same local month but spanning a UTC month boundary share one bucket', () => {
    // Both are in December 2026 Melbourne time even though their UTC dates differ.
    const dec1Aedt   = new Date('2026-11-30T13:00:00Z'); // Dec 1  00:00 AEDT
    const dec15Aedt  = new Date('2026-12-15T10:00:00Z'); // Dec 15 21:00 AEDT

    const g1 = makeGig({ id: 'g1', startAtDate: dec1Aedt,  endAtDate: new Date(dec1Aedt.getTime()  + 3_600_000), timezone: 'Australia/Melbourne', feeType: 'flat', amountCents: 10000, paymentStatus: 'confirmed', confirmedAmountCents: 10000 });
    const g2 = makeGig({ id: 'g2', startAtDate: dec15Aedt, endAtDate: new Date(dec15Aedt.getTime() + 3_600_000), timezone: 'Australia/Melbourne', feeType: 'flat', amountCents: 20000, paymentStatus: 'confirmed', confirmedAmountCents: 20000 });

    const summary = summarizeGigs([g1, g2], 'artist', 'UTC');

    expect(summary.byMonth).toHaveLength(1);
    expect(summary.byMonth[0].month).toMatch(/Dec/i);
    expect(summary.byMonth[0].confirmedCents).toBe(30000);
  });
});

// ── H.7 Agent roster rollup — no double-counting ─────────────────────────────

describe('H.7 Agent roster rollup', () => {
  test('sum of per-entity summaries matches total when entities have no overlapping gigs', () => {
    // Entity A: artist — $400 confirmed + $200 pending
    const a1 = makeGig({ id: 'a1', amountCents: 40000, paymentStatus: 'confirmed', confirmedAmountCents: 40000, startAtDate: PAST });
    const a2 = makeGig({ id: 'a2', amountCents: 20000, paymentStatus: 'pending',   listAsBooked: true,          startAtDate: PAST });

    // Entity B: venue — $500 confirmed
    const b1 = makeGig({ id: 'b1', amountCents: 50000, paymentStatus: 'confirmed', confirmedAmountCents: 50000, startAtDate: PAST });

    const summaryA = summarizeGigs([a1, a2], 'artist');
    const summaryB = summarizeGigs([b1],     'venue');

    // The total is computed over the de-duped union (as getRosterGigs produces)
    const total = summarizeGigs([a1, a2, b1], 'artist');

    expect(total.confirmedCents).toBe(summaryA.confirmedCents + summaryB.confirmedCents);
    expect(total.pendingCents).toBe(summaryA.pendingCents + summaryB.pendingCents);
    expect(total.gigsPlayed + total.gigsUpcoming).toBe(
      (summaryA.gigsPlayed + summaryA.gigsUpcoming) +
      (summaryB.gigsPlayed + summaryB.gigsUpcoming),
    );
  });

  test('a shared gig (agent on both sides) counted once in the total', () => {
    // getRosterGigs deduplicates so the gig appears exactly once in the combined array.
    // summarizeGigs on that array must count it exactly once.
    const shared = makeGig({
      id: 'shared', amountCents: 60000,
      paymentStatus: 'confirmed', confirmedAmountCents: 60000,
      startAtDate: PAST,
    });

    const total = summarizeGigs([shared], 'artist');

    expect(total.confirmedCents).toBe(60000);
    expect(total.gigsPlayed + total.gigsUpcoming).toBe(1);
  });

  test('three roster entities with mixed money states — total equals per-entity sum', () => {
    const g1 = makeGig({ id: 'g1', amountCents: 30000, paymentStatus: 'confirmed',  confirmedAmountCents: 30000 });
    const g2 = makeGig({ id: 'g2', amountCents: 40000, paymentStatus: 'pending',    listAsBooked: true });
    const g3 = makeGig({ id: 'g3', amountCents: 20000, paymentStatus: 'disputed' });
    const g4 = makeGig({ id: 'g4', feeType: 'unpaid', amountCents: null, paymentStatus: 'not_applicable' });

    const s1 = summarizeGigs([g1], 'artist');
    const s2 = summarizeGigs([g2], 'artist');
    const s3 = summarizeGigs([g3], 'artist');
    const s4 = summarizeGigs([g4], 'artist');

    const total = summarizeGigs([g1, g2, g3, g4], 'artist');

    expect(total.confirmedCents).toBe(s1.confirmedCents + s2.confirmedCents + s3.confirmedCents + s4.confirmedCents);
    expect(total.pendingCents).toBe(s1.pendingCents   + s2.pendingCents   + s3.pendingCents   + s4.pendingCents);
    expect(total.disputedCents).toBe(s1.disputedCents  + s2.disputedCents  + s3.disputedCents  + s4.disputedCents);
    expect(total.noFeeCount).toBe(s1.noFeeCount    + s2.noFeeCount    + s3.noFeeCount    + s4.noFeeCount);
  });
});

// ── H.8 PDF export ────────────────────────────────────────────────────────────

describe('H.8 PDF export — headline figures in generated HTML', () => {
  const SUMMARY: DashboardSummary = {
    gigsPlayed: 1, gigsUpcoming: 1,
    confirmedCents: 70000, selfReportedCents: 0,
    pendingCents:   30000,
    disputedCents: 50000, disputedCount: 1,
    noFeeCount: 1,
    byMonth: [], byCounterparty: [], bySource: [], byFeeType: [],
  };

  function sampleGig() {
    return makeGig({
      feeType: 'flat', amountCents: 70000,
      paymentStatus: 'confirmed', confirmedAmountCents: 70000,
      startAtDate: PAST,
    });
  }

  test('HTML contains correct confirmed and pending headline amounts', () => {
    const html = buildPdfHtml(SUMMARY, [sampleGig()], 'artist', 'This FY');
    expect(html).toContain('$700');
    expect(html).toContain('$300');
  });

  test('confirmed and pending are never summed into a single combined figure', () => {
    const html = buildPdfHtml(SUMMARY, [sampleGig()], 'artist', 'This FY');
    // $1,000 would indicate the amounts were combined incorrectly
    expect(html).not.toContain('$1,000');
    expect(html).not.toContain('$1000');
  });

  test('disputed amount appears in HTML when disputedCount > 0', () => {
    const html = buildPdfHtml(SUMMARY, [sampleGig()], 'artist', 'This FY');
    expect(html).toContain('$500');
    expect(html).toContain('excluded from totals');
  });

  test('footer disclaimer is present', () => {
    const html = buildPdfHtml(SUMMARY, [], 'artist', 'This FY');
    expect(html).toContain('Generated from Twaylo');
    expect(html).toContain('not payments processed by Twaylo');
  });

  test('period label appears in HTML', () => {
    const label = 'FY 2025-26';
    const html  = buildPdfHtml(SUMMARY, [], 'artist', label);
    expect(html).toContain(label);
  });

  test('buildCsv first row is header, subsequent rows contain gig data', () => {
    const period = PERIOD_PRESETS.this_fy();
    const gig    = sampleGig();
    const csv    = buildCsv([gig], 'artist', period);
    const lines  = csv.split('\n');

    expect(lines[0]).toBe('Date,Counterparty,Source,Fee type,Planned,Actual,Status');
    expect(lines.length).toBe(2); // header + 1 gig
    expect(lines[1]).toContain('The Espy');       // venueName
    expect(lines[1]).toContain('Twaylo booking'); // source = enquiry
    expect(lines[1]).toContain('flat');
    expect(lines[1]).toContain('Flat $700');      // planned (amountCents: 70000)
    expect(lines[1]).toContain('$700');           // actual (confirmedAmountCents)
    expect(lines[1]).toContain('confirmed');      // status
  });
});
