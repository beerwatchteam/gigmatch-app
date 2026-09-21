/**
 * Unit tests for slot helper pure functions in lib/useGigs.ts.
 * Firebase SDK calls are mocked — no emulator needed.
 */

// Mock Firebase modules before importing useGigs to avoid initialisation
jest.mock('../../lib/firebase', () => ({
  db:      {},
  storage: {},
  auth:    {},
}));
jest.mock('firebase/firestore', () => {
  const actual = jest.requireActual('firebase/firestore');
  return { ...actual };
});
jest.mock('../../lib/useEnquiries', () => ({
  sendMessage:      jest.fn(),
  postSystemMessage: jest.fn(),
  confirmHeadliner: jest.fn(),
}));

import {
  applySlotBooking,
  removeSlotBooking,
  updateOverrideDetails,
  SlotConflictError,
} from '../../lib/useGigs';
import { FRIDAY_SLOT } from '../seed';

// ── Fixture ──────────────────────────────────────────────────────────────────

function baseSlots() {
  return {
    Friday: [
      {
        ...FRIDAY_SLOT,
        // Explicitly no fee/settled/paid/notes/docs keys on the template
      },
    ],
  };
}

const SLOT_KEY = {
  day:  'Friday',
  date: '2026-11-14',
  time: '8:00 PM',
  room: 'Main Room',
};

// ── 1. applySlotBooking on open template ─────────────────────────────────────

describe('applySlotBooking', () => {
  test('creates date-specific override; template is untouched', () => {
    const slots  = baseSlots();
    const result = applySlotBooking(slots, SLOT_KEY, 'booked', { gigId: 'g1', actName: 'Test Band' });

    // Template unchanged
    expect(result.Friday[0].date).toBeUndefined();
    expect(result.Friday[0].status).toBe('open');

    // New override
    const override = result.Friday.find((s: any) => s.date === '2026-11-14');
    expect(override).toBeDefined();
    expect(override.status).toBe('booked');
    expect(override.gigId).toBe('g1');
    expect(override.bandName).toBe('Test Band');
    expect(override.day).toBe('Friday');
    expect(override.date).toBe('2026-11-14');
    expect(override.time).toBe('8:00 PM');
    expect(override.room).toBe('Main Room');
  });

  test('override inherits template fields (duration, loadIn, soundcheck)', () => {
    const result   = applySlotBooking(baseSlots(), SLOT_KEY, 'booked', { gigId: 'g1' });
    const override = result.Friday.find((s: any) => s.date === '2026-11-14');
    expect(override.duration).toBe(45);
    expect(override.loadIn).toBe('18:30');
    expect(override.soundcheck).toBe('17:30');
  });

  test('deny-list: override never contains fee, feeSnapshot, settled*, paid*, notes, docs', () => {
    const denyList = ['fee', 'feeSnapshot', 'settledAmountCents', 'settledAt', 'paidAt', 'paidAmountCents', 'notes', 'docs'];
    // Even if template somehow carried these keys, they must not appear
    const slots = baseSlots();
    // Safety: assert template doesn't already have them
    denyList.forEach(k => expect(slots.Friday[0]).not.toHaveProperty(k));

    const result   = applySlotBooking(slots, SLOT_KEY, 'booked', { gigId: 'g1' });
    const override = result.Friday.find((s: any) => s.date === '2026-11-14');
    denyList.forEach(k => {
      expect(override).not.toHaveProperty(k);
    });
  });

  test('same gigId is idempotent — no conflict, no duplicate', () => {
    const s1 = applySlotBooking(baseSlots(), SLOT_KEY, 'booked', { gigId: 'g1', actName: 'Band A' });
    const s2 = applySlotBooking(s1, SLOT_KEY, 'booked', { gigId: 'g1', actName: 'Band A' });
    expect(s2.Friday.filter((s: any) => s.date === '2026-11-14')).toHaveLength(1);
  });

  test('different gigId on booked slot → SlotConflictError', () => {
    const s1 = applySlotBooking(baseSlots(), SLOT_KEY, 'booked', { gigId: 'g1' });
    expect(() => applySlotBooking(s1, SLOT_KEY, 'booked', { gigId: 'g2' }))
      .toThrow(SlotConflictError);
  });

  test('different gigId on pending slot → SlotConflictError', () => {
    const s1 = applySlotBooking(baseSlots(), SLOT_KEY, 'pending', { gigId: 'g1' });
    expect(() => applySlotBooking(s1, SLOT_KEY, 'pending', { gigId: 'g2' }))
      .toThrow(SlotConflictError);
  });

  test('override with no gigId (legacy) does NOT conflict', () => {
    const slots = {
      Friday: [
        { ...FRIDAY_SLOT, date: '2026-11-14', status: 'booked', bandName: 'Legacy Band' },
      ],
    };
    // No gigId → should not throw
    expect(() => applySlotBooking(slots, SLOT_KEY, 'booked', { gigId: 'g2' }))
      .not.toThrow();
  });

  test('one-off gig at custom time creates override with day/date/time/room', () => {
    const key    = { day: 'Saturday', date: '2026-11-21', time: '9:00 PM', room: 'Bar Stage' };
    const result = applySlotBooking(baseSlots(), key, 'booked', { gigId: 'g3' });
    const o      = result.Saturday?.[0] ?? result.Friday?.find((s: any) => s.date === '2026-11-21');
    // It goes on Saturday
    expect(result.Saturday).toBeDefined();
    const override = result.Saturday![0];
    expect(override.day).toBe('Saturday');
    expect(override.date).toBe('2026-11-21');
    expect(override.time).toBe('9:00 PM');
    expect(override.room).toBe('Bar Stage');
  });
});

// ── 2. removeSlotBooking ─────────────────────────────────────────────────────

describe('removeSlotBooking', () => {
  test('removes only the override with matching gigId', () => {
    const s1 = applySlotBooking(baseSlots(), SLOT_KEY, 'booked', { gigId: 'g1' });
    const s2 = removeSlotBooking(s1, 'g1');
    expect(s2.Friday.find((s: any) => s.gigId === 'g1')).toBeUndefined();
    // Template still present
    expect(s2.Friday.find((s: any) => !s.date && s.status === 'open')).toBeDefined();
  });

  test('no-op when gigId not found', () => {
    const slots  = baseSlots();
    const result = removeSlotBooking(slots, 'nonexistent');
    expect(result.Friday.length).toBe(slots.Friday.length);
  });
});

// ── 3. updateOverrideDetails ─────────────────────────────────────────────────

describe('updateOverrideDetails', () => {
  test('patches gigName, ticketUrl, ticketPriceCents, actName, description only', () => {
    const s1 = applySlotBooking(baseSlots(), SLOT_KEY, 'booked', { gigId: 'g1', actName: 'Old Name' });

    const updates = {
      gigName:          'New Event Name',
      actName:          'New Act Name',
      ticketUrl:        'https://example.com/tickets',
      ticketPriceCents: 2000,
      description:      'Great show',
    };
    const s2       = updateOverrideDetails(s1, 'g1', updates);
    const override = s2.Friday.find((s: any) => s.gigId === 'g1');

    expect(override.gigName).toBe('New Event Name');
    expect(override.actName).toBe('New Act Name');
    expect(override.ticketUrl).toBe('https://example.com/tickets');
    expect(override.ticketPriceCents).toBe(2000);
    expect(override.description).toBe('Great show');

    // Must not touch status or other slot fields
    expect(override.status).toBe('booked');
    expect(override.gigId).toBe('g1');
  });

  test('does not modify other slots', () => {
    const s1 = applySlotBooking(baseSlots(), SLOT_KEY, 'booked', { gigId: 'g1' });
    const s2 = updateOverrideDetails(s1, 'g1', { gigName: 'Updated' });
    // Template unchanged
    const template = s2.Friday.find((s: any) => !s.date && s.status === 'open');
    expect(template.gigName).toBeUndefined();
  });
});
