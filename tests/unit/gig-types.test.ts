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
import type { GigFee } from '../../lib/gig-types';

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
