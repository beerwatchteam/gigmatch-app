/**
 * Unit tests for lib/payment-status.ts
 *
 * Tests every status rule from the dashboard handoff §2:
 *   PS.1  not_applicable (unpaid)
 *   PS.2  paid (confirmed)
 *   PS.3  self_reported
 *   PS.4  upcoming (gig date in the future)
 *   PS.5  disputed
 *   PS.6  needsAmount (split, no confirmedAmountCents)
 *   PS.7  awaiting (legacy — no terms, never overdue)
 *   PS.8  overdue (dueDate in the past)
 *   PS.9  due today
 *   PS.10 due (dueDate in the future)
 *   PS.11 upcoming takes priority over needsAmount for future splits
 *   PS.12 disputed on a past gig overrides needsAmount
 *   PS.13 paid gig — dueDate preserved in result
 *   PS.14 legacy + split → 'awaiting', not 'needsAmount'
 */

import { Timestamp } from 'firebase/firestore';
import { paymentStatus } from '../../lib/payment-status';
import type { Gig, GigTerms } from '../../lib/gig-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Use UTC noon so calendarDay() returns the right date in any environment.
const TODAY      = new Date('2026-10-07T12:00:00Z');
const PAST_GIG   = new Date('2026-09-15T09:00:00Z'); // 7pm Melbourne AEST
const FUTURE_GIG = new Date('2026-11-01T09:00:00Z'); // 8pm Melbourne AEDT

const TERMS: GigTerms = {
  model:       'flat',
  amount:      40000,
  splitTerms:  null,
  doorPercent: null,
  timing:      'Within 7 days',
  methods:     ['Bank transfer'],
};

function makeGig(overrides: {
  feeType?:             Gig['fee']['type'];
  amountCents?:         number | null;
  doorPercent?:         number | null;
  paymentStatus?:       string;
  confirmedAmountCents?: number | null;
  startAtDate?:         Date;
  dueDate?:             string | null;
  terms?:               GigTerms | undefined;
}): Gig {
  const {
    feeType              = 'flat',
    amountCents          = 40000,
    doorPercent          = null,
    paymentStatus: ps    = 'pending',
    confirmedAmountCents = null,
    startAtDate          = PAST_GIG,
    dueDate              = '2026-09-22',   // 7 days after PAST_GIG date
    terms                = TERMS,
  } = overrides;

  return {
    id: 'g-test',
    enquiryId: null,
    venueId: 'v1', venueName: 'Test Venue',
    venueUid: 'vu1',
    artistUid: 'a1', artistName: 'Test Band', bandName: 'Test Band',
    title: null, description: null, locationText: null, state: null,
    isPublic: false,
    status: 'confirmed',
    source: 'enquiry',
    startAt: Timestamp.fromDate(startAtDate),
    endAt: Timestamp.fromDate(new Date(startAtDate.getTime() + 3_600_000)),
    timezone: 'Australia/Melbourne',
    setLengthMinutes: null, loadInTime: null, soundCheckTime: null, room: null,
    fee: {
      type: feeType, amountCents, doorPercent,
      ticketPriceCents: null, ticketUrl: null, notes: null,
    },
    payment: {
      timing: 'after', timingProposal: null,
      status: ps as any,
      venueConfirm: null, artistConfirm: null,
      confirmedAmountCents,
      confirmedAt: confirmedAmountCents != null ? Timestamp.fromDate(new Date(0)) : null,
      reminderSentAt: null,
      updatedAt: Timestamp.fromDate(new Date(0)),
      dueDate: dueDate ?? undefined,
    },
    terms,
    participantIds: ['a1', 'vu1'],
    createdBy: 'vu1',
    listAsBooked: true,
    createdAt: Timestamp.fromDate(new Date(0)),
    updatedAt: Timestamp.fromDate(new Date(0)),
  };
}

// ── PS.1  not_applicable ───────────────────────────────────────────────────────

describe('PS.1 — not_applicable (unpaid)', () => {
  test('returns not_applicable with null dueDate and daysOverdue', () => {
    const gig = makeGig({ feeType: 'unpaid', paymentStatus: 'not_applicable', amountCents: null });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('not_applicable');
    expect(result.dueDate).toBeNull();
    expect(result.daysOverdue).toBeNull();
  });
});

// ── PS.2  paid ────────────────────────────────────────────────────────────────

describe('PS.2 — paid (confirmed)', () => {
  test('returns paid when payment.status is confirmed', () => {
    const gig = makeGig({ paymentStatus: 'confirmed', confirmedAmountCents: 40000 });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('paid');
    expect(result.daysOverdue).toBeNull();
  });
});

// ── PS.13  paid preserves dueDate ─────────────────────────────────────────────

describe('PS.13 — paid gig preserves dueDate in result', () => {
  test('dueDate is returned for paid gigs', () => {
    const gig = makeGig({ paymentStatus: 'confirmed', confirmedAmountCents: 40000, dueDate: '2026-09-22' });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('paid');
    expect(result.dueDate).toBe('2026-09-22');
  });
});

// ── PS.3  self_reported ───────────────────────────────────────────────────────

describe('PS.3 — self_reported', () => {
  test('returns self_reported when payment.status is self_reported', () => {
    const gig = makeGig({ paymentStatus: 'self_reported', confirmedAmountCents: 30000 });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('self_reported');
  });
});

// ── PS.4  upcoming ────────────────────────────────────────────────────────────

describe('PS.4 — upcoming (gig date in the future)', () => {
  test('returns upcoming for a future gig with pending status', () => {
    const gig = makeGig({ startAtDate: FUTURE_GIG });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('upcoming');
    expect(result.daysOverdue).toBeNull();
  });

  test('future gig date — dueDate is returned even for upcoming', () => {
    const gig = makeGig({ startAtDate: FUTURE_GIG, dueDate: '2026-11-08' });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('upcoming');
    expect(result.dueDate).toBe('2026-11-08');
  });
});

// ── PS.11  upcoming takes priority over needsAmount ───────────────────────────

describe('PS.11 — upcoming takes priority over needsAmount for future splits', () => {
  test('future door_split with no confirmedAmountCents is upcoming, not needsAmount', () => {
    const gig = makeGig({
      feeType: 'door_split',
      amountCents: null,
      doorPercent: 70,
      startAtDate: FUTURE_GIG,
      confirmedAmountCents: null,
    });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('upcoming');
  });
});

// ── PS.5  disputed ────────────────────────────────────────────────────────────

describe('PS.5 — disputed', () => {
  test('returns disputed ("Amounts don\'t match") for past gig', () => {
    const gig = makeGig({ paymentStatus: 'disputed' });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('disputed');
    expect(result.daysOverdue).toBeNull();
  });

  test('future disputed gig also returns disputed', () => {
    const gig = makeGig({ paymentStatus: 'disputed', startAtDate: FUTURE_GIG });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('disputed');
  });
});

// ── PS.12  disputed on a past gig overrides needsAmount ──────────────────────

describe('PS.12 — disputed overrides needsAmount', () => {
  test('past door_split with disputed status returns disputed, not needsAmount', () => {
    const gig = makeGig({
      feeType: 'door_split',
      amountCents: null,
      doorPercent: 80,
      paymentStatus: 'disputed',
      confirmedAmountCents: null,
    });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('disputed');
  });
});

// ── PS.6  needsAmount ─────────────────────────────────────────────────────────

describe('PS.6 — needsAmount (split played, no amount)', () => {
  test('past door_split with no confirmedAmountCents returns needsAmount', () => {
    const gig = makeGig({ feeType: 'door_split', amountCents: null, doorPercent: 70, confirmedAmountCents: null });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('needsAmount');
  });

  test('past ticket_split with no confirmedAmountCents returns needsAmount', () => {
    const gig = makeGig({ feeType: 'ticket_split', amountCents: null, confirmedAmountCents: null });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('needsAmount');
  });

  test('past bar_split with no confirmedAmountCents returns needsAmount', () => {
    const gig = makeGig({ feeType: 'bar_split', amountCents: null, confirmedAmountCents: null });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('needsAmount');
  });

  test('past door_split with confirmedAmountCents recorded is paid instead', () => {
    const gig = makeGig({
      feeType: 'door_split', amountCents: null, doorPercent: 70,
      paymentStatus: 'confirmed', confirmedAmountCents: 32000,
    });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('paid');
  });
});

// ── PS.7  awaiting (legacy docs) ──────────────────────────────────────────────

describe('PS.7 — awaiting (legacy doc without terms, never overdue)', () => {
  test('past flat gig with no terms returns awaiting, not overdue', () => {
    const gig = makeGig({ terms: undefined, dueDate: null });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('awaiting');
    expect(result.dueDate).toBeNull();
    expect(result.daysOverdue).toBeNull();
  });

  test('past flat gig with terms but no dueDate returns awaiting', () => {
    const gig = makeGig({ dueDate: null });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('awaiting');
    expect(result.dueDate).toBeNull();
  });
});

// ── PS.14  legacy + split is awaiting, not needsAmount ───────────────────────

describe('PS.14 — legacy door_split without terms is awaiting, not needsAmount', () => {
  test('past door_split with no terms and no confirmedAmountCents returns awaiting', () => {
    const gig = makeGig({
      feeType: 'door_split', amountCents: null, doorPercent: 60,
      confirmedAmountCents: null,
      terms: undefined,
      dueDate: null,
    });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('awaiting');
  });
});

// ── PS.8  overdue ─────────────────────────────────────────────────────────────

describe('PS.8 — overdue (dueDate in the past)', () => {
  test('dueDate 4 days ago → overdue with correct daysOverdue', () => {
    // TODAY is 2026-10-07; due date 4 days prior
    const gig = makeGig({ dueDate: '2026-10-03' });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('overdue');
    expect(result.daysOverdue).toBe(4);
    expect(result.dueDate).toBe('2026-10-03');
  });

  test('dueDate 1 day ago → overdue with daysOverdue 1', () => {
    const gig = makeGig({ dueDate: '2026-10-06' });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('overdue');
    expect(result.daysOverdue).toBe(1);
  });
});

// ── PS.9  due today ───────────────────────────────────────────────────────────

describe('PS.9 — due today', () => {
  test('dueDate is today → due, not overdue', () => {
    const gig = makeGig({ dueDate: '2026-10-07' });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('due');
    expect(result.daysOverdue).toBeNull();
    expect(result.dueDate).toBe('2026-10-07');
  });
});

// ── PS.10  due (dueDate in the future) ───────────────────────────────────────

describe('PS.10 — due (dueDate in the future)', () => {
  test('dueDate 3 days from now → due', () => {
    const gig = makeGig({ dueDate: '2026-10-10' });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('due');
    expect(result.daysOverdue).toBeNull();
    expect(result.dueDate).toBe('2026-10-10');
  });

  test('"On the night" gig played today → due (dueDate = today)', () => {
    const gig = makeGig({
      startAtDate: new Date('2026-10-07T19:00:00+11:00'),
      dueDate: '2026-10-07',
      terms: { ...TERMS, timing: 'On the night' },
    });
    const result = paymentStatus(gig, TODAY);
    expect(result.status).toBe('due');
  });
});
