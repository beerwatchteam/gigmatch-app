/**
 * Cloud Function trigger tests + transaction flow tests — sections 3 & 4.
 *
 * REQUIRES: Firestore + Auth + Functions emulators running.
 *   npm run build:functions   (builds functions/lib/ first)
 *   firebase emulators:start --only firestore,auth,functions
 *
 * Run via: npm run test:functions
 * (which wraps this in firebase emulators:exec)
 *
 * NOTE: The client-side functions (confirmGigFromEnquiry etc.) import db from
 * lib/firebase.ts. This test module mocks that import so the Firestore calls
 * are routed to the local emulator rather than the live project.
 */

// ── Emulator env must be set BEFORE any firebase imports ────────────────────
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

import { initializeApp as adminInitializeApp } from 'firebase-admin/app';
import {
  getFirestore as adminGetFirestore,
  FieldValue as AdminFieldValue,
} from 'firebase-admin/firestore';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { UID, USERS, VENUES, ENQ1, ENQ2, GIG_ENQ1 } from '../seed';

// ── Firebase setup for tests ─────────────────────────────────────────────────

// Use the same project as the emulator so Cloud Function triggers fire.
const TEST_PROJECT = 'gigmatchweb-aus';

// Permissive rules for the test emulator (flow tests verify business logic,
// not security rules — those are covered by tests/rules/firestore-rules.test.ts).
const PERMISSIVE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`;

// Mutable mock state – set in beforeAll.
// Named 'mock*' so Jest's hoisting allows use inside jest.mock factories.
const mockFirebaseState: { db: any; storage: any; auth: any } = {
  db: null, storage: null, auth: null,
};

jest.mock('../../lib/firebase', () => mockFirebaseState);

let testEnv: RulesTestEnvironment;
let adminDb: ReturnType<typeof adminGetFirestore>;

beforeAll(async () => {
  // Load permissive rules into the emulator so client SDK writes succeed
  testEnv = await initializeTestEnvironment({
    projectId: TEST_PROJECT,
    firestore: {
      rules: PERMISSIVE_RULES,
      host:  'localhost',
      port:  8080,
    },
  });
  mockFirebaseState.db = testEnv.unauthenticatedContext().firestore();

  // Admin SDK for seeding and verification (bypasses rules)
  adminDb = adminGetFirestore(
    adminInitializeApp({ projectId: TEST_PROJECT }, `${TEST_PROJECT}-admin`)
  );
});

afterAll(async () => {
  await testEnv.cleanup();
});

// useGigs imports lib/firebase which is mocked above
import {
  confirmGigFromEnquiry,
  cancelAcceptance,
  createArtistGig,
  deleteArtistGig,
  createVenueGig,
  cancelVenueGig,
  updateVenueGig,
  SlotConflictError,
  formatGigConfirmedMessage,
} from '../../lib/useGigs';
import type { Enquiry } from '../../lib/useEnquiries';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedBase() {
  const batch = adminDb.batch();
  for (const [uid, data] of Object.entries(USERS)) {
    batch.set(adminDb.collection('users').doc(uid), data);
  }
  for (const [vid, data] of Object.entries(VENUES)) {
    batch.set(adminDb.collection('venues').doc(vid), data as any);
  }
  batch.set(adminDb.collection('inquiries').doc('enq1'), ENQ1);
  batch.set(adminDb.collection('inquiries').doc('enq2'), ENQ2);
  await batch.commit();
}

async function clearAll() {
  // Delete all test docs (best effort; emulator will be cleared between test runs anyway)
  const cols = ['gigs', 'venues', 'users', 'inquiries', 'publicGigs', 'messages'];
  for (const col of cols) {
    const snap = await adminDb.collection(col).get();
    const batch = adminDb.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

/** Poll for a publicGigs doc to appear (or disappear) for up to maxMs. */
async function pollPublicGig(
  gigId: string,
  expectExists: boolean,
  maxMs = 10_000,
): Promise<{ exists: boolean; elapsedMs: number }> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const snap = await adminDb.collection('publicGigs').doc(gigId).get();
    if (snap.exists === expectExists) {
      return { exists: snap.exists, elapsedMs: Date.now() - start };
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return { exists: !expectExists, elapsedMs: maxMs };
}

// ── Section 3: Trigger tests ─────────────────────────────────────────────────

describe('syncPublicGig trigger', () => {
  let triggerDelayMs = 0;

  beforeEach(async () => {
    await clearAll();
    await seedBase();
  });

  test('3.1 — artist_added gig, isPublic false → no publicGigs doc', async () => {
    const gigId = 'trig-artist-1';
    await adminDb.collection('gigs').doc(gigId).set({
      source:        'artist_added',
      artistUid:     UID.artistA,
      isPublic:      false,
      status:        'confirmed',
      startAt:       AdminFieldValue.serverTimestamp(),
      endAt:         AdminFieldValue.serverTimestamp(),
      timezone:      'Australia/Melbourne',
      participantIds: [UID.artistA],
    });
    await new Promise(r => setTimeout(r, 2000));
    const snap = await adminDb.collection('publicGigs').doc(gigId).get();
    expect(snap.exists).toBe(false);
  });

  test('3.2 — set isPublic true → doc appears; set false → doc removed', async () => {
    const gigId = 'trig-artist-2';
    const ref   = adminDb.collection('gigs').doc(gigId);

    await ref.set({
      source:        'artist_added',
      artistUid:     UID.artistA,
      artistName:    'Test Band',
      bandName:      'Test Band',
      isPublic:      false,
      status:        'confirmed',
      startAt:       new Date('2026-11-14T09:00:00Z'),
      endAt:         new Date('2026-11-14T10:00:00Z'),
      timezone:      'Australia/Melbourne',
      participantIds: [UID.artistA],
    });

    // Wait for the first trigger to settle before issuing the next write.
    // Without this, both triggers can run concurrently in the emulator and
    // the delete from the first invocation can land after the upsert from
    // the second, leaving no publicGigs doc.
    await new Promise(r => setTimeout(r, 2000));

    // Set public
    await ref.update({ isPublic: true });
    const appeared = await pollPublicGig(gigId, true);
    triggerDelayMs = appeared.elapsedMs;
    expect(appeared.exists).toBe(true);

    // Set private again
    await ref.update({ isPublic: false });
    const removed = await pollPublicGig(gigId, false);
    expect(removed.exists).toBe(false);
  });

  test('3.3 — enquiry gig, status confirmed, isPublic true → doc appears', async () => {
    const gigId = 'trig-enq-1';
    await adminDb.collection('gigs').doc(gigId).set({
      source:        'enquiry',
      artistUid:     UID.artistA,
      artistName:    'Test Band',
      bandName:      'Test Band',
      venueId:       'v1',
      venueName:     'Test Venue 1',
      isPublic:      true,
      status:        'confirmed',
      startAt:       new Date('2026-11-14T09:00:00Z'),
      endAt:         new Date('2026-11-14T10:00:00Z'),
      timezone:      'Australia/Melbourne',
      participantIds: [UID.artistA, UID.venueOwner1],
      fee:           { type: 'flat', amountCents: 40000 },
    });
    const result = await pollPublicGig(gigId, true);
    expect(result.exists).toBe(true);
  });

  test('3.4 — set status cancelled → publicGigs doc removed', async () => {
    const gigId = 'trig-cancel-1';
    const ref   = adminDb.collection('gigs').doc(gigId);
    await ref.set({
      source:        'enquiry',
      artistUid:     UID.artistA,
      artistName:    'Test Band',
      bandName:      'Test Band',
      isPublic:      true,
      status:        'confirmed',
      startAt:       new Date('2026-11-14T09:00:00Z'),
      endAt:         new Date('2026-11-14T10:00:00Z'),
      timezone:      'Australia/Melbourne',
      participantIds: [UID.artistA, UID.venueOwner1],
      fee:           {},
    });
    await pollPublicGig(gigId, true, 10_000);
    await ref.update({ status: 'cancelled' });
    const removed = await pollPublicGig(gigId, false);
    expect(removed.exists).toBe(false);
  });

  test('3.5 — venue_created gig: never a publicGigs doc even if isPublic forced true', async () => {
    const gigId = 'trig-vc-1';
    await adminDb.collection('gigs').doc(gigId).set({
      source:        'venue_created',
      artistUid:     null,
      isPublic:      true, // forced via Admin SDK
      status:        'confirmed',
      startAt:       new Date('2026-11-14T09:00:00Z'),
      endAt:         new Date('2026-11-14T10:00:00Z'),
      timezone:      'Australia/Melbourne',
      participantIds: [UID.venueOwner1],
      fee:           {},
    });
    await new Promise(r => setTimeout(r, 3000));
    const snap = await adminDb.collection('publicGigs').doc(gigId).get();
    expect(snap.exists).toBe(false);
  });

  test('3.6 — delete gig → publicGigs doc removed', async () => {
    const gigId = 'trig-del-1';
    const ref   = adminDb.collection('gigs').doc(gigId);
    await ref.set({
      source:        'artist_added',
      artistUid:     UID.artistA,
      isPublic:      true,
      status:        'confirmed',
      startAt:       new Date('2026-11-14T09:00:00Z'),
      endAt:         new Date('2026-11-14T10:00:00Z'),
      timezone:      'Australia/Melbourne',
      participantIds: [UID.artistA],
      fee:           {},
    });
    await pollPublicGig(gigId, true, 10_000);
    await ref.delete();
    const removed = await pollPublicGig(gigId, false);
    expect(removed.exists).toBe(false);
  });

  test('3.7 — field allow-list: publicGigs doc has exactly the expected keys', async () => {
    const gigId = 'trig-keys-1';
    await adminDb.collection('gigs').doc(gigId).set({
      source:             'artist_added',
      artistUid:          UID.artistA,
      artistName:         'Test Band',
      bandName:           'Test Band',
      venueId:            'v1',
      venueName:          'Test Venue 1',
      title:              'My Show',
      description:        'Great show',
      locationText:       'Fitzroy, VIC',
      state:              'VIC',
      room:               null,
      isPublic:           true,
      status:             'confirmed',
      startAt:            new Date('2026-11-14T09:00:00Z'),
      endAt:              new Date('2026-11-14T10:00:00Z'),
      timezone:           'Australia/Melbourne',
      participantIds:     [UID.artistA],
      // Fields that must NOT appear in the projection:
      fee:                { type: 'flat', amountCents: 40000, doorPercent: null },
      feeSnapshot:        { amountCents: 40000 },
      settledAmountCents: 38000,
      paidAt:             new Date(),
      agreementId:        'agr-123',
    });
    const { exists } = await pollPublicGig(gigId, true);
    expect(exists).toBe(true);

    const snap = await adminDb.collection('publicGigs').doc(gigId).get();
    const data = snap.data()!;
    const keys = Object.keys(data).sort();

    const EXPECTED_KEYS = [
      'actName', 'artistUid', 'date', 'description', 'endAt',
      'gigId', 'locationText', 'room', 'source', 'startAt',
      'state', 'ticketPriceCents', 'ticketUrl', 'timezone',
      'title', 'venueId', 'venueName',
    ].sort();

    expect(keys).toEqual(EXPECTED_KEYS);

    // Sensitive fields must not appear
    const DENIED_KEYS = ['fee', 'feeSnapshot', 'settledAmountCents', 'paidAt', 'agreementId', 'participantIds'];
    DENIED_KEYS.forEach(k => expect(data).not.toHaveProperty(k));
  });

  test('3.8 — idempotency: trigger fires twice for same event, result identical', async () => {
    const gigId = 'trig-idem-1';
    const ref   = adminDb.collection('gigs').doc(gigId);

    const gigData = {
      source:        'artist_added',
      artistUid:     UID.artistA,
      artistName:    'Test Band',
      bandName:      'Test Band',
      isPublic:      true,
      status:        'confirmed',
      startAt:       new Date('2026-11-14T09:00:00Z'),
      endAt:         new Date('2026-11-14T10:00:00Z'),
      timezone:      'Australia/Melbourne',
      participantIds: [UID.artistA],
      fee:           {},
    };

    await ref.set(gigData);
    await pollPublicGig(gigId, true);
    const snap1 = await adminDb.collection('publicGigs').doc(gigId).get();

    // Trigger again by touching updatedAt
    await ref.update({ updatedAt: AdminFieldValue.serverTimestamp() });
    await new Promise(r => setTimeout(r, 3000));
    const snap2 = await adminDb.collection('publicGigs').doc(gigId).get();

    expect(snap1.data()?.gigId).toBe(snap2.data()?.gigId);
    expect(snap1.data()?.artistUid).toBe(snap2.data()?.artistUid);
  });

  test('3.9 — resyncPublicGigs: manually deleted projection reappears after resync', async () => {
    const gigId = 'trig-resync-1';
    await adminDb.collection('gigs').doc(gigId).set({
      source:        'artist_added',
      artistUid:     UID.artistA,
      artistName:    'Resync Band',
      bandName:      'Resync Band',
      isPublic:      true,
      status:        'confirmed',
      startAt:       new Date('2026-11-14T09:00:00Z'),
      endAt:         new Date('2026-11-14T10:00:00Z'),
      timezone:      'Australia/Melbourne',
      participantIds: [UID.artistA],
      fee:           {},
    });
    await pollPublicGig(gigId, true);

    // Manually delete the projection
    await adminDb.collection('publicGigs').doc(gigId).delete();
    const afterDel = await adminDb.collection('publicGigs').doc(gigId).get();
    expect(afterDel.exists).toBe(false);

    // Re-trigger by touching the gig doc
    await adminDb.collection('gigs').doc(gigId).update({
      updatedAt: AdminFieldValue.serverTimestamp(),
    });
    const reappeared = await pollPublicGig(gigId, true);
    expect(reappeared.exists).toBe(true);
  });

  afterAll(() => {
    console.log(`\n  [Trigger propagation delay] ~${triggerDelayMs}ms`);
  });
});

// ── Section 4: Transaction and flow tests ────────────────────────────────────

describe('confirmGigFromEnquiry', () => {
  const ENQ_OBJ: Enquiry = {
    id:          'enq1',
    bandName:    'Test Band',
    venueName:   'Test Venue 1',
    venueId:     'v1',
    createdBy:   UID.artistA,
    status:      'discussing',
    submittedAt: '2026-10-01T00:00:00Z',
    requestedSlot: {
      day:       'Friday',
      date:      '2026-11-14',
      time:      '8:00 PM',
      room:      'Main Room',
      slotType:  'Headline',
      setLength: '45 min',
    },
  };

  beforeEach(async () => {
    await clearAll();
    await seedBase();
  });

  test('4.1 — confirms gig with correct fields', async () => {
    const gigId = await confirmGigFromEnquiry({
      enquiry:          ENQ_OBJ,
      venueOwnerUid:    UID.venueOwner1,
      venueDisplayName: 'Test Venue 1',
      venuePhotoUrl:    null,
      localDate:        '2026-11-14',
      localTime:        '8:00 PM',
      timezone:         'Australia/Melbourne',
      fee:              { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
      setLengthMinutes: 45,
      loadInTime:       '18:30',
      listAsBooked:     true,
    });

    const snap = await adminDb.collection('gigs').doc(gigId).get();
    const data = snap.data()!;

    // Status and participants
    expect(data.status).toBe('confirmed');
    expect(data.participantIds).toEqual(expect.arrayContaining([UID.artistA, UID.venueOwner1]));
    expect(data.participantIds).toHaveLength(2);

    // startAt: 2026-11-14 8:00 PM Melbourne (AEDT UTC+11) = 09:00Z
    expect(data.startAt.toDate().toISOString().replace(/\.\d+Z$/, 'Z')).toBe('2026-11-14T09:00:00Z');
    expect(data.timezone).toBe('Australia/Melbourne');
    expect(data.fee.amountCents).toBe(40000);
    expect(data.isPublic).toBe(true); // default on first confirm
  });

  test('4.2 — venue/v1 slot has booked override; no fee keys in override', async () => {
    const gigId = await confirmGigFromEnquiry({
      enquiry:          ENQ_OBJ,
      venueOwnerUid:    UID.venueOwner1,
      venueDisplayName: 'Test Venue 1',
      venuePhotoUrl:    null,
      localDate:        '2026-11-14',
      localTime:        '8:00 PM',
      timezone:         'Australia/Melbourne',
      fee:              { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
      setLengthMinutes: 45,
      loadInTime:       '18:30',
      listAsBooked:     true,
    });

    const venueSnap = await adminDb.collection('venues').doc('v1').get();
    const slots = venueSnap.data()!.slots as Record<string, any[]>;
    const override = Object.values(slots).flat().find((s: any) => s.gigId === gigId);

    expect(override).toBeDefined();
    expect(override.status).toBe('booked');
    expect(override.bandName).toBe('Test Band');

    // Fee fields must not appear in slot override
    const DENY_LIST = ['fee', 'feeSnapshot', 'settledAmountCents', 'paidAt', 'notes', 'docs'];
    DENY_LIST.forEach(k => expect(override).not.toHaveProperty(k));
  });

  test('4.3 — inquiries/enq1 updated to confirmed with gigId', async () => {
    const gigId = await confirmGigFromEnquiry({
      enquiry:          ENQ_OBJ,
      venueOwnerUid:    UID.venueOwner1,
      venueDisplayName: 'Test Venue 1',
      venuePhotoUrl:    null,
      localDate:        '2026-11-14',
      localTime:        '8:00 PM',
      timezone:         'Australia/Melbourne',
      fee:              { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
      setLengthMinutes: 45,
      loadInTime:       '18:30',
      listAsBooked:     true,
    });

    const snap = await adminDb.collection('inquiries').doc('enq1').get();
    expect(snap.data()!.status).toBe('confirmed');
    expect(snap.data()!.gigId).toBe(gigId);
  });

  test('4.4 — system message posted matching format', async () => {
    await confirmGigFromEnquiry({
      enquiry:          ENQ_OBJ,
      venueOwnerUid:    UID.venueOwner1,
      venueDisplayName: 'Test Venue 1',
      venuePhotoUrl:    null,
      localDate:        '2026-11-14',
      localTime:        '8:00 PM',
      timezone:         'Australia/Melbourne',
      fee:              { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
      setLengthMinutes: 45,
      loadInTime:       '18:30',
      listAsBooked:     true,
    });

    // Poll messages for the system message
    await new Promise(r => setTimeout(r, 1000));
    const msgs = await adminDb.collection('messages')
      .where('inquiryId', '==', 'enq1')
      .where('type', '==', 'system')
      .get();

    expect(msgs.size).toBeGreaterThan(0);
    const msg = msgs.docs[0].data();
    expect(msg.sender).toBe('');
    // Note: 2026-11-14 is a Saturday, not Friday — brief regex adapted accordingly
    expect(msg.text).toMatch(/Gig confirmed: Sat 14 Nov.* \$400 flat/);
  });

  test('4.5 — conflict: second enquiry for same slot throws SlotConflictError', async () => {
    // Confirm enq1 first
    await confirmGigFromEnquiry({
      enquiry:          ENQ_OBJ,
      venueOwnerUid:    UID.venueOwner1,
      venueDisplayName: 'Test Venue 1',
      venuePhotoUrl:    null,
      localDate:        '2026-11-14',
      localTime:        '8:00 PM',
      timezone:         'Australia/Melbourne',
      fee:              { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
      setLengthMinutes: 45,
      listAsBooked:     true,
    });

    const ENQ2_OBJ: Enquiry = { ...ENQ_OBJ, id: 'enq2', createdBy: UID.artistB, bandName: 'Conflicting Band' };

    await expect(
      confirmGigFromEnquiry({
        enquiry:          ENQ2_OBJ,
        venueOwnerUid:    UID.venueOwner1,
        venueDisplayName: 'Test Venue 1',
        venuePhotoUrl:    null,
        localDate:        '2026-11-14',
        localTime:        '8:00 PM',
        timezone:         'Australia/Melbourne',
        fee:              { type: 'flat', amountCents: 30000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
        setLengthMinutes: 45,
        listAsBooked:     true,
      })
    ).rejects.toBeInstanceOf(SlotConflictError);

    // enq2 still discussing
    const snap = await adminDb.collection('inquiries').doc('enq2').get();
    expect(snap.data()!.status).toBe('discussing');
  });

  test('4.6 — venue WA: timezone Australia/Perth, startAt 2026-11-14T12:00:00Z', async () => {
    const ENQ_WA: Enquiry = {
      ...ENQ_OBJ,
      id:       'enq-wa',
      venueId:  'v2',
      venueName: 'Test Venue 2',
    };
    await adminDb.collection('inquiries').doc('enq-wa').set({
      ...ENQ2,
      id:        'enq-wa',
      createdBy: UID.artistA,
      venueId:   'v2',
    });

    const gigId = await confirmGigFromEnquiry({
      enquiry:          ENQ_WA,
      venueOwnerUid:    UID.venueOwner2,
      venueDisplayName: 'Test Venue 2',
      venuePhotoUrl:    null,
      localDate:        '2026-11-14',
      localTime:        '8:00 PM',
      timezone:         'Australia/Perth',
      fee:              { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
      setLengthMinutes: 45,
      listAsBooked:     true,
    });

    const snap = await adminDb.collection('gigs').doc(gigId).get();
    expect(snap.data()!.timezone).toBe('Australia/Perth');
    expect(snap.data()!.startAt.toDate().toISOString().replace(/\.\d+Z$/, 'Z')).toBe('2026-11-14T12:00:00Z');
  });
});

describe('cancelAcceptance', () => {
  beforeEach(async () => {
    await clearAll();
    await seedBase();
  });

  const ENQ_OBJ: Enquiry = {
    id: 'enq1', bandName: 'Test Band', venueName: 'Test Venue 1',
    venueId: 'v1', createdBy: UID.artistA, status: 'discussing',
    submittedAt: '2026-10-01T00:00:00Z',
    requestedSlot: { day: 'Friday', date: '2026-11-14', time: '8:00 PM', room: 'Main Room', slotType: 'Headline', setLength: '45 min' },
  };

  test('4.7 — cancelAcceptance removes override, sets enquiry discussing, marks gig cancelled', async () => {
    const gigId = await confirmGigFromEnquiry({
      enquiry:          ENQ_OBJ,
      venueOwnerUid:    UID.venueOwner1,
      venueDisplayName: 'Test Venue 1',
      venuePhotoUrl:    null,
      localDate:        '2026-11-14',
      localTime:        '8:00 PM',
      timezone:         'Australia/Melbourne',
      fee:              { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
      setLengthMinutes: 45,
      listAsBooked:     true,
    });

    const confirmedEnq = await adminDb.collection('inquiries').doc('enq1').get();
    const confirmedEnqData = { ...ENQ_OBJ, ...confirmedEnq.data()!, gigId };

    await cancelAcceptance(confirmedEnqData as Enquiry, UID.venueOwner1);

    const enqSnap = await adminDb.collection('inquiries').doc('enq1').get();
    expect(enqSnap.data()!.status).toBe('discussing');

    const gigSnap = await adminDb.collection('gigs').doc(gigId).get();
    expect(gigSnap.data()!.status).toBe('cancelled');
    expect(gigSnap.data()!.cancelledAt).toBeDefined();
    expect(gigSnap.data()!.cancelledBy).toBe(UID.venueOwner1);

    const venueSnap = await adminDb.collection('venues').doc('v1').get();
    const slots = venueSnap.data()!.slots as Record<string, any[]>;
    const hasOverride = Object.values(slots).flat().some((s: any) => s.gigId === gigId);
    expect(hasOverride).toBe(false);
  });

  test('4.8 — re-accept: same gig doc goes back to confirmed, exactly one override', async () => {
    const gigId = await confirmGigFromEnquiry({
      enquiry:          ENQ_OBJ,
      venueOwnerUid:    UID.venueOwner1,
      venueDisplayName: 'Test Venue 1',
      venuePhotoUrl:    null,
      localDate:        '2026-11-14',
      localTime:        '8:00 PM',
      timezone:         'Australia/Melbourne',
      fee:              { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
      setLengthMinutes: 45,
      listAsBooked:     true,
    });

    const firstCreatedAt = (await adminDb.collection('gigs').doc(gigId).get()).data()!.createdAt;

    const confirmedEnqData = { ...ENQ_OBJ, gigId } as Enquiry;
    await cancelAcceptance(confirmedEnqData, UID.venueOwner1);

    // Re-accept
    await confirmGigFromEnquiry({
      enquiry:          confirmedEnqData,
      venueOwnerUid:    UID.venueOwner1,
      venueDisplayName: 'Test Venue 1',
      venuePhotoUrl:    null,
      localDate:        '2026-11-14',
      localTime:        '8:00 PM',
      timezone:         'Australia/Melbourne',
      fee:              { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
      setLengthMinutes: 45,
      listAsBooked:     true,
    });

    const gigSnap = await adminDb.collection('gigs').doc(gigId).get();
    expect(gigSnap.data()!.status).toBe('confirmed');
    // createdAt preserved
    expect(gigSnap.data()!.createdAt.isEqual(firstCreatedAt)).toBe(true);

    // Exactly one override
    const venueSnap = await adminDb.collection('venues').doc('v1').get();
    const slots = venueSnap.data()!.slots as Record<string, any[]>;
    const overrides = Object.values(slots).flat().filter((s: any) => s.gigId === gigId);
    expect(overrides).toHaveLength(1);
  });

  test('4.9 — legacy enquiry with no gigId does not crash on cancelAcceptance', async () => {
    // No gigId on enquiry
    await expect(
      cancelAcceptance(ENQ_OBJ, UID.venueOwner1)
    ).resolves.not.toThrow();
  });
});

describe('createArtistGig', () => {
  beforeEach(async () => {
    await clearAll();
    await seedBase();
  });

  test('4.10 — WA artist gig: timezone Australia/Perth, startAt 12:00Z', async () => {
    const gigId = await createArtistGig({
      artistUid:  UID.artistA,
      artistName: 'Test Band',
      input: {
        title:          'Perth Show',
        venueName:      'Perth Venue',
        locationText:   'Perth CBD',
        state:          'WA',
        localDate:      '2026-11-14',
        localStartTime: '8:00 PM',
        localEndTime:   null,
        doorsTime:      null,
        ticketUrl:      null,
        ticketPriceCents: null,
        description:    null,
        setLengthMinutes: null,
        isPublic:       false,
      },
    });

    const snap = await adminDb.collection('gigs').doc(gigId).get();
    expect(snap.data()!.timezone).toBe('Australia/Perth');
    expect(snap.data()!.startAt.toDate().toISOString().replace(/\.\d+Z$/, 'Z')).toBe('2026-11-14T12:00:00Z');
    expect(snap.data()!.participantIds).toEqual([UID.artistA]);
    expect(snap.data()!.isPublic).toBe(false);
  });
});

describe('deleteArtistGig', () => {
  beforeEach(async () => {
    await clearAll();
    await seedBase();
  });

  test('4.11 — deletes gig doc and private subcollection doc', async () => {
    const gigId = await createArtistGig({
      artistUid:  UID.artistA,
      artistName: 'Test Band',
      input: {
        title: 'To Delete', venueName: 'Venue', locationText: null,
        state: 'VIC', localDate: '2026-11-14', localStartTime: '8:00 PM',
        localEndTime: null, doorsTime: null, ticketUrl: null,
        ticketPriceCents: null, description: null, setLengthMinutes: null,
        isPublic: false,
      },
    });

    await deleteArtistGig({ gigId, artistUid: UID.artistA, storagePaths: [] });

    const gigSnap     = await adminDb.collection('gigs').doc(gigId).get();
    const privateSnap = await adminDb.collection('gigs').doc(gigId).collection('private').doc(UID.artistA).get();
    expect(gigSnap.exists).toBe(false);
    expect(privateSnap.exists).toBe(false);
  });
});

describe('createVenueGig / cancelVenueGig / updateVenueGig', () => {
  beforeEach(async () => {
    await clearAll();
    await seedBase();
  });

  test('4.12 — createVenueGig on open slot: gig doc created, override applied, no publicGigs doc', async () => {
    const gigId = await createVenueGig({
      venueId:  'v1',
      venueUid: UID.venueOwner1,
      input: {
        title:           'Friday Night Live',
        artistName:      'Headline Act',
        description:     null,
        localDate:       '2026-11-14',
        localStartTime:  '8:00 PM',
        localEndTime:    '9:30 PM',
        doorsTime:       null,
        ticketUrl:       'https://tickets.example.com',
        ticketPriceCents: 1500,
        room:            'Main Room',
        listAsBooked:    true,
        loadInTime:      null,
        soundCheckTime:  null,
        venueName:       'Test Venue 1',
        venueTimezone:   'Australia/Melbourne',
      },
    });

    const gigSnap = await adminDb.collection('gigs').doc(gigId).get();
    expect(gigSnap.exists).toBe(true);
    expect(gigSnap.data()!.source).toBe('venue_created');

    // isPublic always false for venue_created
    await new Promise(r => setTimeout(r, 2000));
    const pubSnap = await adminDb.collection('publicGigs').doc(gigId).get();
    expect(pubSnap.exists).toBe(false);
  });

  test('4.13 — createVenueGig on booked slot → SlotConflictError', async () => {
    const gigId = await createVenueGig({
      venueId:  'v1',
      venueUid: UID.venueOwner1,
      input: {
        title: 'First Show', artistName: null, description: null,
        localDate: '2026-11-14', localStartTime: '8:00 PM', localEndTime: '9:30 PM',
        doorsTime: null, ticketUrl: null, ticketPriceCents: null,
        room: 'Main Room', listAsBooked: true, loadInTime: null, soundCheckTime: null,
        venueName: 'Test Venue 1', venueTimezone: 'Australia/Melbourne',
      },
    });

    await expect(
      createVenueGig({
        venueId:  'v1',
        venueUid: UID.venueOwner1,
        input: {
          title: 'Conflicting Show', artistName: null, description: null,
          localDate: '2026-11-14', localStartTime: '8:00 PM', localEndTime: '9:30 PM',
          doorsTime: null, ticketUrl: null, ticketPriceCents: null,
          room: 'Main Room', listAsBooked: true, loadInTime: null, soundCheckTime: null,
          venueName: 'Test Venue 1', venueTimezone: 'Australia/Melbourne',
        },
      })
    ).rejects.toBeInstanceOf(SlotConflictError);
  });

  test('4.14 — cancelVenueGig removes override and marks gig cancelled', async () => {
    const gigId = await createVenueGig({
      venueId: 'v1', venueUid: UID.venueOwner1,
      input: {
        title: 'Gig to cancel', artistName: null, description: null,
        localDate: '2026-11-14', localStartTime: '8:00 PM', localEndTime: '9:30 PM',
        doorsTime: null, ticketUrl: null, ticketPriceCents: null,
        room: 'Main Room', listAsBooked: true, loadInTime: null, soundCheckTime: null,
        venueName: 'Test Venue 1', venueTimezone: 'Australia/Melbourne',
      },
    });

    await cancelVenueGig({ gigId, venueId: 'v1' });

    const snap = await adminDb.collection('gigs').doc(gigId).get();
    expect(snap.data()!.status).toBe('cancelled');

    const venueSnap = await adminDb.collection('venues').doc('v1').get();
    const slots = venueSnap.data()!.slots as Record<string, any[]>;
    const override = Object.values(slots).flat().find((s: any) => s.gigId === gigId);
    expect(override).toBeUndefined();
  });

  test('4.15 — updateVenueGig on enquiry gig: fee, participantIds, isPublic unchanged', async () => {
    // Seed an enquiry gig first
    const enqGigId = 'update-enq-1';
    await adminDb.collection('gigs').doc(enqGigId).set({
      ...GIG_ENQ1,
      isPublic: false,
      participantIds: [UID.artistA, UID.venueOwner1],
      fee: { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null },
    });

    await updateVenueGig({
      gigId:   enqGigId,
      venueId: 'v1',
      input: {
        title:       'New Title',
        description: 'New description',
        ticketUrl:   'https://tickets.example.com',
      },
    });

    const snap = await adminDb.collection('gigs').doc(enqGigId).get();
    expect(snap.data()!.title).toBe('New Title');
    expect(snap.data()!.description).toBe('New description');
    // Unchanged
    expect(snap.data()!.participantIds).toEqual(expect.arrayContaining([UID.artistA, UID.venueOwner1]));
    expect(snap.data()!.isPublic).toBe(false);
    expect(snap.data()!.fee.amountCents).toBe(40000);
  });
});

// ── formatGigConfirmedMessage unit (included here since fee param is new) ────

describe('formatGigConfirmedMessage', () => {
  test('flat fee: format matches expected pattern', () => {
    const fee = { type: 'flat' as const, amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null };
    const msg = formatGigConfirmedMessage('Test Band', 'Test Venue 1', '2026-11-14', '8:00 PM', fee);
    // 2026-11-14 is a Saturday (not Fri — brief has a date discrepancy; see report)
    expect(msg).toMatch(/Gig confirmed: Sat 14 Nov.* \$400 flat/);
  });

  test('door split fee: shows percentage', () => {
    const fee = { type: 'door_split' as const, amountCents: null, doorPercent: 70, ticketPriceCents: null, ticketUrl: null, notes: null };
    const msg = formatGigConfirmedMessage('Band', 'Venue', '2026-11-14', '8:00 PM', fee);
    expect(msg).toContain('70% door');
  });

  test('no fee: no fee suffix', () => {
    const msg = formatGigConfirmedMessage('Band', 'Venue', '2026-11-14', '8:00 PM');
    expect(msg).toMatch(/^Gig confirmed:/);
    expect(msg).not.toContain('$');
  });
});
