/**
 * Unit tests for lib/gig-types.ts — pure functions, no Firebase emulator required.
 *
 * toStartAt wraps firebase/firestore Timestamp, which works as a standalone class
 * without Firebase initialisation.
 */

import {
  toStartAt,
  dollarsToCents,
  parseSetLength,
  validateTicketUrl,
  validateDoorSplitPct,
  validateFee,
  STATE_TZ,
} from '../../lib/gig-types';
import type { GigFee, Gig } from '../../lib/gig-types';
import { moneyState, isPaymentActive, formatAud } from '../../lib/payments';

// ── 1. toStartAt ─────────────────────────────────────────────────────────────

describe('toStartAt', () => {
  function utc(date: string, time: string, tz: string): string {
    return toStartAt(date, time, tz).toDate().toISOString().replace('.000', '');
  }

  const MEL = 'Australia/Melbourne';
  const PER = 'Australia/Perth';
  const BRI = 'Australia/Brisbane';
  const ADL = 'Australia/Adelaide';
  const DAR = 'Australia/Darwin';

  test.each([
    // AEDT = UTC+11 (DST active November)
    ['2026-11-14', '8:00 PM',  MEL, '2026-11-14T09:00:00Z'],
    // AEST = UTC+10 (standard time July)
    ['2026-07-10', '8:00 PM',  MEL, '2026-07-10T10:00:00Z'],
    // AWST = UTC+8 (no DST)
    ['2026-11-14', '8:00 PM',  PER, '2026-11-14T12:00:00Z'],
    // AEST = UTC+10 (QLD, no DST)
    ['2026-11-14', '8:00 PM',  BRI, '2026-11-14T10:00:00Z'],
    // ACDT = UTC+10:30 (DST active November)
    ['2026-11-14', '8:00 PM',  ADL, '2026-11-14T09:30:00Z'],
    // ACST = UTC+9:30 (NT, no DST)
    ['2026-11-14', '8:00 PM',  DAR, '2026-11-14T10:30:00Z'],
    // 12:00 AM = midnight → previous UTC day
    ['2026-11-14', '12:00 AM', MEL, '2026-11-13T13:00:00Z'],
    // 12:00 PM = noon
    ['2026-11-14', '12:00 PM', MEL, '2026-11-14T01:00:00Z'],
    // 11:30 PM
    ['2026-11-14', '11:30 PM', MEL, '2026-11-14T12:30:00Z'],
  ])('toStartAt(%s, %s, %s) → %s', (date, time, tz, expected) => {
    // Strip sub-second precision from both sides for comparison
    const result = toStartAt(date, time, tz).toDate().toISOString().replace(/\.\d+Z$/, 'Z');
    expect(result).toBe(expected);
  });

  test('throws for 24-hour time (hour > 12) without AM/PM', () => {
    expect(() => toStartAt('2026-11-14', '13:00', MEL)).toThrow();
  });

  test('throws for unparseable time string', () => {
    expect(() => toStartAt('2026-11-14', 'abc', MEL)).toThrow();
  });

  test('DST gap (2026-10-04 2:30 AM Melbourne) does not throw', () => {
    // Melbourne clocks jump from 2:00 AM to 3:00 AM on first Sunday of October
    // date-fns-tz fromZonedTime snaps to 3:00 AM local
    expect(() => toStartAt('2026-10-04', '2:30 AM', MEL)).not.toThrow();
    const ts = toStartAt('2026-10-04', '2:30 AM', MEL);
    expect(ts.toDate() instanceof Date).toBe(true);
    expect(isNaN(ts.toDate().getTime())).toBe(false);
  });
});

// ── End time roll-over ───────────────────────────────────────────────────────

describe('endAt roll-over', () => {
  test('11:30 PM + 90 min on 2026-11-14 Melbourne → 2026-11-14T14:00:00Z', () => {
    const { Timestamp } = require('firebase/firestore');
    const startAt = toStartAt('2026-11-14', '11:30 PM', 'Australia/Melbourne');
    const rawEnd  = Timestamp.fromDate(new Date(startAt.toDate().getTime() + 90 * 60_000));
    // rawEnd is already past midnight, should NOT roll (already next day)
    expect(rawEnd.toDate().toISOString().replace(/\.\d+Z$/, 'Z')).toBe('2026-11-14T14:00:00Z');
  });

  test('end time before start rolls to next day', () => {
    const { Timestamp } = require('firebase/firestore');
    const start  = toStartAt('2026-11-14', '8:00 PM', 'Australia/Melbourne'); // 09:00Z
    const rawEnd = toStartAt('2026-11-14', '7:00 PM', 'Australia/Melbourne'); // 08:00Z — before start
    const endAt  = rawEnd.toDate() <= start.toDate()
      ? Timestamp.fromDate(new Date(rawEnd.toDate().getTime() + 24 * 3_600_000))
      : rawEnd;
    // 08:00Z + 24h = next day 08:00Z
    expect(endAt.toDate().toISOString().replace(/\.\d+Z$/, 'Z')).toBe('2026-11-15T08:00:00Z');
  });
});

// ── 2. parseSetLength ────────────────────────────────────────────────────────

describe('parseSetLength', () => {
  test.each([
    ['45 min',   45],
    ['1 hr',     60],
    ['1.5 hours',90],
    ['90',       90],
    ['',         null],
    ['abc',      null],
  ])('parseSetLength(%j) → %j', (input, expected) => {
    expect(parseSetLength(input)).toBe(expected);
  });

  test('null falls back to slot.duration (contract: caller responsibility)', () => {
    // parseSetLength itself returns null; the caller falls back to slot.duration
    expect(parseSetLength('abc')).toBeNull();
  });
});

// ── 3. dollarsToCents ────────────────────────────────────────────────────────

describe('dollarsToCents', () => {
  test.each([
    ['400',    40000],
    ['400.50', 40050],
    ['19.99',  1999],
    ['0.10',   10],
    ['1,200',  120000],
    ['',       null],
    ['-5',     null],
    ['abc',    null],
  ])('dollarsToCents(%j) → %j', (input, expected) => {
    expect(dollarsToCents(input)).toBe(expected);
  });

  test('numeric input 400 → 40000', () => {
    expect(dollarsToCents(400)).toBe(40000);
  });

  test('all non-null results are integers', () => {
    for (const v of ['100', '19.99', '0.10', '1,500.50']) {
      const c = dollarsToCents(v);
      if (c !== null) expect(Number.isInteger(c)).toBe(true);
    }
  });
});

// ── 4. validateTicketUrl ─────────────────────────────────────────────────────

describe('validateTicketUrl', () => {
  test('https:// URL → valid', () => {
    expect(validateTicketUrl('https://x.com/t')).toBe(true);
  });

  test.each([
    ['http://x.com'],
    ['javascript:alert(1)'],
    ['x.com'],
    [''],
  ])('rejects %j', (url) => {
    expect(validateTicketUrl(url)).toBe(false);
  });
});

// ── 5. validateDoorSplitPct ──────────────────────────────────────────────────

describe('validateDoorSplitPct', () => {
  test.each([0, 50, 100])('%i → valid', (pct) => {
    expect(validateDoorSplitPct(pct)).toBe(true);
  });

  test.each([-1, 101, 150])('%i → invalid', (pct) => {
    expect(validateDoorSplitPct(pct)).toBe(false);
  });
});

// ── 6. validateFee ───────────────────────────────────────────────────────────

describe('validateFee', () => {
  const base: GigFee = {
    type: 'flat', amountCents: 40000,
    doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null,
  };

  test('flat with amount → valid', () => {
    expect(validateFee(base)).toBeNull();
  });

  test('flat without amount → error', () => {
    expect(validateFee({ ...base, amountCents: null })).not.toBeNull();
  });

  test('guarantee_vs_door with amount → valid', () => {
    expect(validateFee({ ...base, type: 'guarantee_vs_door' })).toBeNull();
  });

  test('door_split with valid pct → valid', () => {
    const f: GigFee = { ...base, type: 'door_split', amountCents: null, doorPercent: 70 };
    expect(validateFee(f)).toBeNull();
  });

  test('door_split without pct → error', () => {
    const f: GigFee = { ...base, type: 'door_split', amountCents: null, doorPercent: null };
    expect(validateFee(f)).not.toBeNull();
  });

  test('door_split with out-of-range pct → error', () => {
    const f: GigFee = { ...base, type: 'door_split', amountCents: null, doorPercent: 150 };
    expect(validateFee(f)).not.toBeNull();
  });

  test('unpaid needs neither amount nor pct', () => {
    const f: GigFee = { ...base, type: 'unpaid', amountCents: null, doorPercent: null };
    expect(validateFee(f)).toBeNull();
  });

  test('other needs neither amount nor pct', () => {
    const f: GigFee = { ...base, type: 'other', amountCents: null, doorPercent: null };
    expect(validateFee(f)).toBeNull();
  });
});

// ── 7. STATE_TZ ──────────────────────────────────────────────────────────────

describe('STATE_TZ', () => {
  test.each([
    ['NSW', 'Australia/Sydney'],
    ['VIC', 'Australia/Melbourne'],
    ['QLD', 'Australia/Brisbane'],
    ['SA',  'Australia/Adelaide'],
    ['WA',  'Australia/Perth'],
    ['TAS', 'Australia/Hobart'],
    ['NT',  'Australia/Darwin'],
    ['ACT', 'Australia/Sydney'],
  ])('STATE_TZ[%s] === %s', (state, tz) => {
    expect(STATE_TZ[state]).toBe(tz);
  });

  test('unknown state falls back to Australia/Melbourne via ?? operator', () => {
    expect(STATE_TZ['XX'] ?? 'Australia/Melbourne').toBe('Australia/Melbourne');
    expect(STATE_TZ[''] ?? 'Australia/Melbourne').toBe('Australia/Melbourne');
    expect(STATE_TZ[undefined as any] ?? 'Australia/Melbourne').toBe('Australia/Melbourne');
  });
});

// ── 8. moneyState ─────────────────────────────────────────────────────────────

/** Minimal stub that satisfies the Gig type for moneyState / isPaymentActive. */
function makeGig(overrides: {
  status?: 'confirmed' | 'cancelled';
  feeType?: GigFee['type'];
  amountCents?: number | null;
  doorPercent?: number | null;
  paymentStatus?: string;
  listAsBooked?: boolean;
  confirmedAmountCents?: number | null;
  endAtMs?: number;
  paymentTiming?: 'before' | 'after' | null;
}): Gig {
  const {
    status          = 'confirmed',
    feeType         = 'flat',
    amountCents     = 30000,
    doorPercent     = null,
    paymentStatus   = 'pending',
    listAsBooked    = true,
    confirmedAmountCents = null,
    endAtMs,
    paymentTiming   = null,
  } = overrides;

  const { Timestamp } = require('firebase/firestore');
  const endAt = endAtMs != null ? Timestamp.fromDate(new Date(endAtMs)) : null;

  return {
    id: 'g1', enquiryId: null, venueId: null, venueName: null, venueUid: null,
    artistUid: 'a1', artistName: 'Band', bandName: 'Band',
    title: null, description: null, locationText: null, state: null,
    isPublic: false, status, source: 'artist_added',
    startAt: Timestamp.fromDate(new Date(0)),
    endAt,
    timezone: 'Australia/Melbourne',
    setLengthMinutes: null, loadInTime: null, soundCheckTime: null, room: null,
    fee: { type: feeType, amountCents, doorPercent, ticketPriceCents: null, ticketUrl: null, notes: null },
    payment: {
      timing:               paymentTiming,
      timingProposal:       null,
      status:               paymentStatus as any,
      venueConfirm:         null,
      artistConfirm:        null,
      confirmedAmountCents: confirmedAmountCents,
      confirmedAt:          confirmedAmountCents != null ? Timestamp.fromDate(new Date(0)) : null,
      reminderSentAt:       null,
      updatedAt:            Timestamp.fromDate(new Date(0)),
    },
    participantIds: ['a1'],
    createdBy: 'a1',
    listAsBooked,
    createdAt:  Timestamp.fromDate(new Date(0)),
    updatedAt:  Timestamp.fromDate(new Date(0)),
  };
}

describe('moneyState', () => {
  test.each([
    // fee            paymentStatus   listAsBooked  state        amountCents
    ['flat 30000',    'pending',      true,         'pending',   30000],
    ['flat 30000',    'pending',      false,        'none',      null],
    ['flat 70000',    'confirmed',    false,        'confirmed', 70000],
    ['door_split',    'pending',      true,         'pending',   null],
    ['flat 30000',    'disputed',     true,         'disputed',  30000],
  ] as const)(
    '%s / %s / listAsBooked=%s → %s',
    (feeDesc, paymentStatus, listAsBooked, expectedState, expectedCents) => {
      const feeType = feeDesc.startsWith('door_split') ? 'door_split' : 'flat';
      const amountCents = feeDesc.startsWith('flat') ? parseInt(feeDesc.split(' ')[1]) : null;
      const doorPercent = feeType === 'door_split' ? 70 : null;
      const confirmedAmountCents = paymentStatus === 'confirmed' ? amountCents : null;
      const g = makeGig({ feeType, amountCents, doorPercent, paymentStatus, listAsBooked, confirmedAmountCents });
      const ms = moneyState(g);
      expect(ms.state).toBe(expectedState);
      expect(ms.amountCents).toBe(expectedCents);
    }
  );

  test('guarantee_vs_door 20000 pending listAsBooked → pending, 20000, isMinimum true', () => {
    const g = makeGig({ feeType: 'guarantee_vs_door', amountCents: 20000, paymentStatus: 'pending', listAsBooked: true });
    const ms = moneyState(g);
    expect(ms.state).toBe('pending');
    expect(ms.amountCents).toBe(20000);
    expect(ms.isMinimum).toBe(true);
  });

  test('unpaid → none regardless of listAsBooked', () => {
    const g = makeGig({ feeType: 'unpaid', amountCents: null, paymentStatus: 'not_applicable', listAsBooked: true });
    expect(moneyState(g).state).toBe('none');
  });

  test('cancelled gig → none regardless of fee and payment', () => {
    const g = makeGig({ status: 'cancelled', paymentStatus: 'pending', listAsBooked: true });
    expect(moneyState(g).state).toBe('none');
  });

  test('self_reported returns confirmedAmountCents', () => {
    const g = makeGig({ paymentStatus: 'self_reported', confirmedAmountCents: 30000, listAsBooked: false });
    const ms = moneyState(g);
    expect(ms.state).toBe('self_reported');
    expect(ms.amountCents).toBe(30000);
  });
});

// ── 9. isPaymentActive ───────────────────────────────────────────────────────

describe('isPaymentActive', () => {
  const PAST  = new Date('2020-01-01T00:00:00Z').getTime();
  const FUTURE = new Date('2030-01-01T00:00:00Z').getTime();
  const NOW   = new Date('2025-06-01T12:00:00Z');

  test('timing null (single-party): always active', () => {
    expect(isPaymentActive(makeGig({ paymentTiming: null, endAtMs: FUTURE }), NOW)).toBe(true);
    expect(isPaymentActive(makeGig({ paymentTiming: null, endAtMs: PAST  }), NOW)).toBe(true);
  });

  test('timing before: always active', () => {
    expect(isPaymentActive(makeGig({ paymentTiming: 'before', endAtMs: FUTURE }), NOW)).toBe(true);
    expect(isPaymentActive(makeGig({ paymentTiming: 'before', endAtMs: PAST  }), NOW)).toBe(true);
  });

  test('timing after, endAt in future: not active', () => {
    expect(isPaymentActive(makeGig({ paymentTiming: 'after', endAtMs: FUTURE }), NOW)).toBe(false);
  });

  test('timing after, endAt in past: active', () => {
    expect(isPaymentActive(makeGig({ paymentTiming: 'after', endAtMs: PAST }), NOW)).toBe(true);
  });

  test('timing after, endAt null: not active', () => {
    expect(isPaymentActive(makeGig({ paymentTiming: 'after', endAtMs: undefined }), NOW)).toBe(false);
  });
});

// ── 10. formatAud ────────────────────────────────────────────────────────────

describe('formatAud', () => {
  test.each([
    [40000,  '$400'],
    [40050,  '$400.50'],
    [100,    '$1'],
    [1,      '$0.01'],
    [0,      '$0'],
    [70000,  '$700'],
    [30000,  '$300'],
  ])('formatAud(%i) → %s', (cents, expected) => {
    expect(formatAud(cents)).toBe(expected);
  });
});

// ── 11. moneyState whole-month aggregation ───────────────────────────────────

describe('moneyState aggregation', () => {
  test('flat 70000 confirmed + flat 30000 pending yields $700 confirmed and $300 pending', () => {
    const { Timestamp } = require('firebase/firestore');
    const confirmed = makeGig({
      feeType: 'flat', amountCents: 70000, paymentStatus: 'confirmed',
      confirmedAmountCents: 70000, listAsBooked: true,
    });
    const pending = makeGig({
      feeType: 'flat', amountCents: 30000, paymentStatus: 'pending',
      listAsBooked: true,
    });
    const gigs = [confirmed, pending];
    let totalConfirmed = 0;
    let totalPending   = 0;
    for (const g of gigs) {
      const ms = moneyState(g);
      if (ms.state === 'confirmed' || ms.state === 'self_reported') {
        totalConfirmed += ms.amountCents ?? 0;
      } else if (ms.state === 'pending') {
        totalPending += ms.amountCents ?? 0;
      }
    }
    expect(formatAud(totalConfirmed)).toBe('$700');
    expect(formatAud(totalPending)).toBe('$300');
  });
});
