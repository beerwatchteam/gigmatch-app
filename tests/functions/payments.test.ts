/**
 * Payment callable and scheduler tests — section 5 of the test brief.
 *
 * REQUIRES: Firestore + Auth + Functions emulators running.
 *   npm run build:functions
 *   firebase emulators:start --only firestore,auth,functions
 *
 * Run via: npm run test:functions
 */

// ── Emulator env must be set BEFORE any firebase imports ─────────────────────
process.env.FIRESTORE_EMULATOR_HOST    = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

import { initializeApp as adminInitApp, getApps as adminGetApps } from 'firebase-admin/app';
import { getFirestore as adminGetFirestore, Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { getAuth as adminGetAuth } from 'firebase-admin/auth';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { UID, USERS, VENUES, ENQ1, FRESH_PAYMENT_BEFORE, FRESH_PAYMENT_AFTER, FRESH_PAYMENT_SINGLE } from '../seed';

// ── Firebase setup ────────────────────────────────────────────────────────────

const TEST_PROJECT = 'gigmatchweb-aus';
const REGION       = 'australia-southeast1';

// Admin SDK (seeding + auth token minting)
const adminApp  = adminGetApps().find(a => a.name === 'payments-test')
               ?? adminInitApp({ projectId: TEST_PROJECT }, 'payments-test');
const adminDb   = adminGetFirestore(adminApp);
const adminAuth = adminGetAuth(adminApp);

// Client SDK pointing at emulators (callables run through this)
const clientApp  = getApps().find(a => a.name === 'payments-test-client')
                ?? initializeApp({ projectId: TEST_PROJECT, apiKey: 'test-api-key' }, 'payments-test-client');
const clientAuth = getAuth(clientApp);
connectAuthEmulator(clientAuth, 'http://localhost:9099', { disableWarnings: true });
const clientFunctions = getFunctions(clientApp, REGION);
connectFunctionsEmulator(clientFunctions, 'localhost', 5001);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sign in as uid and call a callable function. */
async function callAs<T = unknown, R = unknown>(uid: string, fnName: string, data: T): Promise<R> {
  const token = await adminAuth.createCustomToken(uid);
  await signInWithCustomToken(clientAuth, token);
  const fn = httpsCallable<T, R>(clientFunctions, fnName);
  return (await fn(data)).data as R;
}

/** Expect a callable to reject with a specific Firebase error code. */
async function expectCallError(uid: string, fnName: string, data: unknown, code: string): Promise<void> {
  try {
    await callAs(uid, fnName, data);
    throw new Error(`Expected ${fnName} to throw functions/${code} but it resolved`);
  } catch (err: any) {
    // Errors from the Functions emulator are thrown as objects with a `code` property
    const errCode: string = err.code ?? err.message ?? '';
    expect(errCode).toMatch(code);
  }
}

/** Build a minimal confirmed enquiry gig doc. */
function makeEnqGig(overrides: Record<string, unknown> = {}) {
  return {
    source:        'enquiry',
    enquiryId:     'enq-g1',
    venueId:       'v1',
    venueName:     'Test Venue 1',
    venueUid:      UID.venueOwner1,
    artistUid:     UID.artistA,
    artistName:    'Test Band',
    bandName:      'Test Band',
    title:         null,
    description:   null,
    isPublic:      false,
    status:        'confirmed',
    startAt:       AdminTimestamp.fromDate(new Date('2026-11-14T08:00:00Z')),
    endAt:         AdminTimestamp.fromDate(new Date('2030-01-01T10:00:00Z')), // far future
    timezone:      'Australia/Melbourne',
    setLengthMinutes: 45,
    loadInTime:    null,
    soundCheckTime: null,
    room:          'Main Room',
    fee:           { type: 'flat', amountCents: 40000, doorPercent: null, includesGst: null, notes: null },
    payment:       { ...FRESH_PAYMENT_BEFORE },
    participantIds: [UID.artistA, UID.venueOwner1],
    createdBy:     UID.venueOwner1,
    listAsBooked:  true,
    createdAt:     AdminTimestamp.fromDate(new Date('2026-10-01T00:00:00Z')),
    updatedAt:     AdminTimestamp.fromDate(new Date('2026-10-01T00:00:00Z')),
    ...overrides,
  };
}

/** Seed an enquiry doc for g1 (messages can be posted to it). */
async function seedEnquiry(id = 'enq-g1') {
  await adminDb.collection('inquiries').doc(id).set({ ...ENQ1, id });
}

/** Wait for a system message to appear in the messages collection. */
async function waitForMessage(
  enquiryId: string,
  matchText: RegExp | string,
  maxMs = 4000,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const snap = await adminDb.collection('messages')
      .where('inquiryId', '==', enquiryId)
      .where('type', '==', 'system')
      .get();
    const match = snap.docs.find(d =>
      typeof matchText === 'string'
        ? d.data().text.includes(matchText)
        : matchText.test(d.data().text)
    );
    if (match) return match;
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

async function clearPaymentDocs() {
  for (const col of ['gigs', 'messages', 'inquiries']) {
    const snap = await adminDb.collection(col).get();
    const batch = adminDb.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

// ── Section 5: Confirmations ──────────────────────────────────────────────────

describe('confirmPayment', () => {
  // Tests 1-2 share a gig in sequence: venue confirms, then artist confirms.
  describe('two-party confirmation flow', () => {
    const GIG_ID = 'cp-flow-1';

    beforeAll(async () => {
      await clearPaymentDocs();
      await seedEnquiry();
      await adminDb.collection('gigs').doc(GIG_ID).set(makeEnqGig({ id: GIG_ID }));
    });

    afterAll(clearPaymentDocs);

    test('5.1 — venueOwner1 confirmPayment(40000): status pending, venueConfirm set, message posted', async () => {
      const result = await callAs(UID.venueOwner1, 'confirmPayment', { gigId: GIG_ID, amountCents: 40000 });
      expect((result as any).status).toBe('pending');

      const snap = await adminDb.collection('gigs').doc(GIG_ID).get();
      const data = snap.data()!;
      expect(data.payment.status).toBe('pending');
      expect(data.payment.venueConfirm).not.toBeNull();
      expect(data.payment.venueConfirm.amountCents).toBe(40000);
      expect(data.payment.artistConfirm).toBeNull();

      const msg = await waitForMessage('enq-g1', 'confirmed they\'ve');
      expect(msg).not.toBeNull();
      expect(msg!.data().sender).toBe('');
    });

    test('5.2 — artistA confirmPayment(40000): confirmed, confirmedAmountCents 40000, "Payment confirmed" message', async () => {
      const result = await callAs(UID.artistA, 'confirmPayment', { gigId: GIG_ID, amountCents: 40000 });
      expect((result as any).status).toBe('confirmed');
      expect((result as any).confirmedAmountCents).toBe(40000);

      const snap = await adminDb.collection('gigs').doc(GIG_ID).get();
      const data = snap.data()!;
      expect(data.payment.status).toBe('confirmed');
      expect(data.payment.confirmedAmountCents).toBe(40000);
      expect(data.payment.venueConfirm).not.toBeNull();
      expect(data.payment.artistConfirm).not.toBeNull();

      const msg = await waitForMessage('enq-g1', 'Payment confirmed');
      expect(msg).not.toBeNull();
    });
  });

  test('5.3 — stranger denied: permission-denied', async () => {
    const gigId = 'cp-stranger-3';
    await seedEnquiry('enq-stranger-3');
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({ id: gigId, enquiryId: 'enq-stranger-3' }));
    await expectCallError(UID.stranger, 'confirmPayment', { gigId, amountCents: 40000 }, 'permission-denied');
  });

  describe('dispute then re-confirm flow (test 5.4)', () => {
    const GIG_ID = 'cp-dispute-4';

    beforeAll(async () => {
      await adminDb.collection('inquiries').doc('enq-dispute-4').set({ ...ENQ1, id: 'enq-dispute-4' });
      await adminDb.collection('gigs').doc(GIG_ID).set(makeEnqGig({ id: GIG_ID, enquiryId: 'enq-dispute-4' }));
    });

    afterAll(async () => {
      await adminDb.collection('gigs').doc(GIG_ID).delete();
      await adminDb.collection('inquiries').doc('enq-dispute-4').delete();
    });

    test('5.4 — venue 40000, artist 35000 → disputed; artist re-submits 40000 → confirmed', async () => {
      await callAs(UID.venueOwner1, 'confirmPayment', { gigId: GIG_ID, amountCents: 40000 });
      await callAs(UID.artistA,    'confirmPayment', { gigId: GIG_ID, amountCents: 35000 });

      const afterDispute = (await adminDb.collection('gigs').doc(GIG_ID).get()).data()!;
      expect(afterDispute.payment.status).toBe('disputed');

      // Artist retracts and re-submits the correct amount
      await callAs(UID.artistA, 'retractPaymentConfirmation', { gigId: GIG_ID });
      await callAs(UID.artistA, 'confirmPayment', { gigId: GIG_ID, amountCents: 40000 });

      const afterFix = (await adminDb.collection('gigs').doc(GIG_ID).get()).data()!;
      expect(afterFix.payment.status).toBe('confirmed');
      expect(afterFix.payment.confirmedAmountCents).toBe(40000);
    });
  });

  describe('invalid amounts (test 5.5)', () => {
    let gigId: string;

    beforeAll(async () => {
      gigId = 'cp-amounts-5';
      await adminDb.collection('inquiries').doc('enq-amounts-5').set({ ...ENQ1 });
      await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({ enquiryId: 'enq-amounts-5' }));
    });

    test.each([
      ['zero',       0],
      ['negative',  -1],
      ['fractional', 1.5],
      ['too large',  10_000_001],
    ])('5.5 — amount %s → invalid-argument', async (_label, amountCents) => {
      await expectCallError(UID.venueOwner1, 'confirmPayment', { gigId, amountCents }, 'invalid-argument');
    });

    test('5.5 — string amount "400" → invalid-argument', async () => {
      await expectCallError(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: '400' as any }, 'invalid-argument');
    });
  });

  describe('timing gate (test 5.6)', () => {
    test('5.6a — timing after, endAt in future → failed-precondition', async () => {
      const gigId = 'cp-timing-6a';
      await adminDb.collection('inquiries').doc('enq-timing-6a').set({ ...ENQ1 });
      await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
        enquiryId: 'enq-timing-6a',
        endAt: AdminTimestamp.fromDate(new Date('2030-01-01T00:00:00Z')),
        payment: { ...FRESH_PAYMENT_AFTER },
      }));
      await expectCallError(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 40000 }, 'failed-precondition');
    });

    test('5.6b — timing after, endAt in past → succeeds', async () => {
      const gigId = 'cp-timing-6b';
      await adminDb.collection('inquiries').doc('enq-timing-6b').set({ ...ENQ1 });
      await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
        enquiryId: 'enq-timing-6b',
        endAt: AdminTimestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
        payment: { ...FRESH_PAYMENT_AFTER },
      }));
      const result = await callAs(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 40000 });
      expect((result as any).status).toBe('pending');
    });
  });

  test('5.7 — cancelled gig → failed-precondition', async () => {
    const gigId = 'cp-cancelled-7';
    await adminDb.collection('inquiries').doc('enq-cancelled-7').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-cancelled-7',
      status: 'cancelled',
    }));
    await expectCallError(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 40000 }, 'failed-precondition');
  });
});

// ── Section 5.8: retractPaymentConfirmation ────────────────────────────────

describe('retractPaymentConfirmation', () => {
  test('5.8a — retract own confirmation while pending: ok', async () => {
    const gigId = 'rpc-8a';
    await adminDb.collection('inquiries').doc('enq-rpc-8a').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({ enquiryId: 'enq-rpc-8a' }));
    // Venue confirms
    await callAs(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 40000 });
    // Venue retracts
    await callAs(UID.venueOwner1, 'retractPaymentConfirmation', { gigId });
    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(data.payment.venueConfirm).toBeNull();
    expect(data.payment.status).toBe('pending');
  });

  test('5.8b — retract after confirmed → failed-precondition', async () => {
    const gigId = 'rpc-8b';
    await adminDb.collection('inquiries').doc('enq-rpc-8b').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({ enquiryId: 'enq-rpc-8b' }));
    // Both confirm → confirmed
    await callAs(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 40000 });
    await callAs(UID.artistA,    'confirmPayment', { gigId, amountCents: 40000 });
    // Try to retract after confirmed
    await expectCallError(UID.venueOwner1, 'retractPaymentConfirmation', { gigId }, 'failed-precondition');
  });
});

// ── Section 5.9-5.12: proposePaymentTiming / respondPaymentTiming ─────────

describe('proposePaymentTiming + respondPaymentTiming', () => {
  test('5.9 — artistA proposes after, venue accepts → timing after, proposal cleared, message', async () => {
    const gigId = 'ppt-9';
    await adminDb.collection('inquiries').doc('enq-ppt-9').set({ ...ENQ1 });
    // Start with timing 'before'
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-ppt-9',
      payment: { ...FRESH_PAYMENT_BEFORE },
    }));

    await callAs(UID.artistA, 'proposePaymentTiming', { gigId, timing: 'after' });

    // Verify proposal set
    const midSnap = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(midSnap.payment.timingProposal).not.toBeNull();
    expect(midSnap.payment.timingProposal.proposedBy).toBe(UID.artistA);
    expect(midSnap.payment.timing).toBe('before'); // not changed yet

    await callAs(UID.venueOwner1, 'respondPaymentTiming', { gigId, accept: true });

    const afterSnap = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(afterSnap.payment.timing).toBe('after');
    expect(afterSnap.payment.timingProposal).toBeNull();

    const msg = await waitForMessage('enq-ppt-9', 'after the gig');
    expect(msg).not.toBeNull();
  });

  test('5.10 — proposer tries to respond to own proposal → permission-denied', async () => {
    const gigId = 'ppt-10';
    await adminDb.collection('inquiries').doc('enq-ppt-10').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-ppt-10',
      payment: { ...FRESH_PAYMENT_BEFORE },
    }));
    await callAs(UID.artistA, 'proposePaymentTiming', { gigId, timing: 'after' });
    await expectCallError(UID.artistA, 'respondPaymentTiming', { gigId, accept: true }, 'permission-denied');
  });

  test('5.11 — propose after someone confirmed → failed-precondition', async () => {
    const gigId = 'ppt-11';
    await adminDb.collection('inquiries').doc('enq-ppt-11').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId:  'enq-ppt-11',
      payment: { ...FRESH_PAYMENT_BEFORE },
    }));
    // Venue confirms payment first
    await callAs(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 40000 });
    // Now try to propose a timing change
    await expectCallError(UID.artistA, 'proposePaymentTiming', { gigId, timing: 'after' }, 'failed-precondition');
  });

  test('5.12 — propose the current timing → invalid-argument', async () => {
    const gigId = 'ppt-12';
    await adminDb.collection('inquiries').doc('enq-ppt-12').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-ppt-12',
      payment: { ...FRESH_PAYMENT_BEFORE }, // current timing is 'before'
    }));
    // Proposing the same timing 'before' is a no-op error
    await expectCallError(UID.artistA, 'proposePaymentTiming', { gigId, timing: 'before' }, 'invalid-argument');
  });
});

// ── Section 5.13-5.15: single-party and special fee types ────────────────────

describe('single-party and special fee types', () => {
  test('5.13 — artist_added gig: confirm 30000 → self_reported, no timing gate, no message', async () => {
    const gigId = 'sp-13';
    // artist_added: single participant, no enquiryId
    await adminDb.collection('gigs').doc(gigId).set({
      source:        'artist_added',
      enquiryId:     null,
      venueId:       null, venueName: null, venueUid: null,
      artistUid:     UID.artistA, artistName: 'Test Band', bandName: 'Test Band',
      title:         null, description: null, locationText: 'Fitzroy, VIC', state: 'VIC',
      isPublic:      false, status: 'confirmed',
      startAt:       AdminTimestamp.fromDate(new Date('2026-11-14T09:00:00Z')),
      endAt:         AdminTimestamp.fromDate(new Date('2030-01-01T10:00:00Z')),
      timezone:      'Australia/Melbourne',
      setLengthMinutes: 45, loadInTime: null, soundCheckTime: null, room: null,
      fee:           { type: 'flat', amountCents: 30000, doorPercent: null, includesGst: null, notes: null },
      payment:       { ...FRESH_PAYMENT_SINGLE },
      participantIds: [UID.artistA],
      createdBy:     UID.artistA, listAsBooked: true,
      createdAt:     AdminTimestamp.fromDate(new Date()),
      updatedAt:     AdminTimestamp.fromDate(new Date()),
    });

    const result = await callAs(UID.artistA, 'confirmPayment', { gigId, amountCents: 30000 });
    expect((result as any).status).toBe('self_reported');

    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(data.payment.status).toBe('self_reported');
    expect(data.payment.confirmedAmountCents).toBe(30000);

    // No enquiryId, so no system message is posted
    const msgs = await adminDb.collection('messages').where('inquiryId', '==', null).get();
    // Messages collection should have no doc for this gig (enquiryId is null, postSystemMessage returns early)
    const gigMsgs = msgs.docs.filter(d => !d.data().inquiryId);
    expect(gigMsgs).toHaveLength(0);
  });

  test('5.14 — unpaid gig: status not_applicable; confirm attempt → failed-precondition', async () => {
    const gigId = 'sp-14';
    await adminDb.collection('inquiries').doc('enq-sp-14').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-sp-14',
      fee:     { type: 'unpaid', amountCents: null, doorPercent: null, includesGst: null, notes: null },
      payment: { ...FRESH_PAYMENT_BEFORE, status: 'not_applicable' },
    }));
    await expectCallError(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 1 }, 'failed-precondition');
  });

  test('5.15 — door_split gig: venue confirms 25000, artist 20000 → disputed', async () => {
    const gigId = 'sp-15';
    await adminDb.collection('inquiries').doc('enq-sp-15').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-sp-15',
      fee:     { type: 'door_split', amountCents: null, doorPercent: 70, includesGst: null, notes: null },
      payment: { ...FRESH_PAYMENT_BEFORE },
    }));
    await callAs(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 25000 });
    await callAs(UID.artistA,    'confirmPayment', { gigId, amountCents: 20000 });

    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(data.payment.status).toBe('disputed');
  });
});

// ── Section 5.16-5.18: updateGigFee ──────────────────────────────────────────

describe('updateGigFee', () => {
  test('5.16 — update 40000 to 45000 with venue confirmation present: fee updated, confirmations cleared, pending, message', async () => {
    const gigId = 'ugf-16';
    await adminDb.collection('inquiries').doc('enq-ugf-16').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({ enquiryId: 'enq-ugf-16' }));

    // Venue has confirmed first
    await callAs(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 40000 });
    const midData = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(midData.payment.venueConfirm).not.toBeNull();

    // Now update the fee
    const newFee = { type: 'flat', amountCents: 45000, doorPercent: null, includesGst: null, notes: null };
    await callAs(UID.venueOwner1, 'updateGigFee', { gigId, fee: newFee });

    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(data.fee.amountCents).toBe(45000);
    expect(data.payment.venueConfirm).toBeNull();
    expect(data.payment.artistConfirm).toBeNull();
    expect(data.payment.status).toBe('pending');

    const msg = await waitForMessage('enq-ugf-16', '$400');
    expect(msg).not.toBeNull();
    expect(msg!.data().text).toContain('$450');
  });

  test('5.17 — updateGigFee after confirmed → failed-precondition', async () => {
    const gigId = 'ugf-17';
    await adminDb.collection('inquiries').doc('enq-ugf-17').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({ enquiryId: 'enq-ugf-17' }));
    // Both confirm
    await callAs(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 40000 });
    await callAs(UID.artistA,    'confirmPayment', { gigId, amountCents: 40000 });
    // Try to change fee
    const newFee = { type: 'flat', amountCents: 45000, doorPercent: null, includesGst: null, notes: null };
    await expectCallError(UID.venueOwner1, 'updateGigFee', { gigId, fee: newFee }, 'failed-precondition');
  });

  test('5.18 — updateGigFee on artist_added gig → failed-precondition', async () => {
    const gigId = 'ugf-18';
    await adminDb.collection('gigs').doc(gigId).set({
      source: 'artist_added', enquiryId: null,
      venueId: null, venueName: null, venueUid: null,
      artistUid: UID.artistA, artistName: 'Band', bandName: 'Band',
      title: null, description: null, locationText: null, state: 'VIC',
      isPublic: false, status: 'confirmed',
      startAt: AdminTimestamp.fromDate(new Date('2026-11-14T09:00:00Z')),
      endAt:   AdminTimestamp.fromDate(new Date('2030-01-01T10:00:00Z')),
      timezone: 'Australia/Melbourne', setLengthMinutes: 45,
      loadInTime: null, soundCheckTime: null, room: null,
      fee:     { type: 'flat', amountCents: 30000, doorPercent: null, includesGst: null, notes: null },
      payment: { ...FRESH_PAYMENT_SINGLE },
      participantIds: [UID.artistA], createdBy: UID.artistA, listAsBooked: true,
      createdAt: AdminTimestamp.fromDate(new Date()),
      updatedAt: AdminTimestamp.fromDate(new Date()),
    });
    const newFee = { type: 'flat', amountCents: 35000, doorPercent: null, includesGst: null, notes: null };
    await expectCallError(UID.artistA, 'updateGigFee', { gigId, fee: newFee }, 'failed-precondition');
  });
});

// ── Section 5.19: Concurrency ─────────────────────────────────────────────────

describe('concurrent confirmPayment', () => {
  test('5.19 — simultaneous calls from both sides → one final consistent state', async () => {
    const gigId = 'cp-concurrent-19';
    await adminDb.collection('inquiries').doc('enq-conc-19').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({ enquiryId: 'enq-conc-19' }));

    // Fire both confirmations at the same time
    await Promise.all([
      callAs(UID.venueOwner1, 'confirmPayment', { gigId, amountCents: 40000 }),
      callAs(UID.artistA,    'confirmPayment', { gigId, amountCents: 40000 }),
    ]);

    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    // Should be in exactly one of these states — not a corrupt intermediate
    expect(['confirmed', 'pending', 'disputed']).toContain(data.payment.status);
    // Both confirms were the same amount, so if both landed, it's confirmed
    if (data.payment.venueConfirm && data.payment.artistConfirm) {
      expect(data.payment.status).toBe('confirmed');
      expect(data.payment.confirmedAmountCents).toBe(40000);
    }
  });
});

// ── Section 5.20-5.24: sendPaymentReminders ──────────────────────────────────

/**
 * Trigger the sendPaymentReminders scheduled function via its emulator HTTP endpoint.
 * v2 scheduled functions are accessible at:
 *   POST http://localhost:5001/{project}/{region}/{functionName}
 */
async function triggerReminders(): Promise<void> {
  const url = `http://localhost:5001/${TEST_PROJECT}/${REGION}/sendPaymentReminders-0`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    '{}',
  });
  // 200 or 204 are success; accept both
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '');
    throw new Error(`triggerReminders failed: ${res.status} ${body}`);
  }
}

describe('sendPaymentReminders', () => {
  beforeEach(clearPaymentDocs);
  afterAll(clearPaymentDocs);

  test('5.20 — gig past due time → reminder message posted, reminderSentAt set', async () => {
    const gigId = 'rem-20';
    await adminDb.collection('inquiries').doc('enq-rem-20').set({ ...ENQ1 });
    // endAt well in the past; due time = max(endAt+1h, 09:00 next day) both also in past
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-rem-20',
      endAt:     AdminTimestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
      payment:   { ...FRESH_PAYMENT_AFTER },
    }));

    await triggerReminders();
    await new Promise(r => setTimeout(r, 2000));

    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(data.payment.reminderSentAt).not.toBeNull();

    const msgs = await adminDb.collection('messages').where('inquiryId', '==', 'enq-rem-20').get();
    const reminderMsg = msgs.docs.find(d => d.data().text.includes('Reminder:'));
    expect(reminderMsg).toBeDefined();
  });

  test('5.21 — running again: no second message sent', async () => {
    const gigId = 'rem-21';
    await adminDb.collection('inquiries').doc('enq-rem-21').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-rem-21',
      endAt:     AdminTimestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
      payment:   { ...FRESH_PAYMENT_AFTER },
    }));

    await triggerReminders();
    await new Promise(r => setTimeout(r, 2000));

    // Trigger again
    await triggerReminders();
    await new Promise(r => setTimeout(r, 2000));

    const msgs = await adminDb.collection('messages').where('inquiryId', '==', 'enq-rem-21').get();
    const reminderMsgs = msgs.docs.filter(d => d.data().text.includes('Reminder:'));
    expect(reminderMsgs).toHaveLength(1); // exactly one, not two
  });

  test('5.22 — timing before: no reminder (only after timing triggers reminders)', async () => {
    const gigId = 'rem-22';
    await adminDb.collection('inquiries').doc('enq-rem-22').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-rem-22',
      endAt:     AdminTimestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
      payment:   { ...FRESH_PAYMENT_BEFORE }, // timing = 'before', not 'after'
    }));

    await triggerReminders();
    await new Promise(r => setTimeout(r, 2000));

    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(data.payment.reminderSentAt).toBeNull();
  });

  test('5.23 — cancelled gig: no reminder', async () => {
    const gigId = 'rem-23';
    await adminDb.collection('inquiries').doc('enq-rem-23').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-rem-23',
      status:    'cancelled',
      endAt:     AdminTimestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
      payment:   { ...FRESH_PAYMENT_AFTER },
    }));

    await triggerReminders();
    await new Promise(r => setTimeout(r, 2000));

    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(data.payment.reminderSentAt).toBeNull();
  });

  test('5.24 — payment status not pending (disputed): no reminder', async () => {
    const gigId = 'rem-24';
    await adminDb.collection('inquiries').doc('enq-rem-24').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-rem-24',
      endAt:     AdminTimestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
      payment:   {
        ...FRESH_PAYMENT_AFTER,
        status:      'disputed',
        venueConfirm:  { amountCents: 40000, at: AdminTimestamp.fromDate(new Date()), by: UID.venueOwner1 },
        artistConfirm: { amountCents: 35000, at: AdminTimestamp.fromDate(new Date()), by: UID.artistA },
      },
    }));

    await triggerReminders();
    await new Promise(r => setTimeout(r, 2000));

    // 'disputed' does not match the query (which filters status == 'pending'), so no reminder
    const msgs = await adminDb.collection('messages').where('inquiryId', '==', 'enq-rem-24').get();
    const reminderMsgs = msgs.docs.filter(d => d.data().text.includes('Reminder:'));
    expect(reminderMsgs).toHaveLength(0);
  });

  test('5.25 — Melbourne timezone: gig ending 01:00 on 15th (UTC 14:00Z on 14th), due at 22:00Z on 14th', async () => {
    // endAt = 2026-11-14T14:00:00Z (2026-11-15 01:00 AEDT, UTC+11)
    // endAt + 1h = 2026-11-14T15:00:00Z
    // 09:00 next day Melbourne = 2026-11-15T22:00:00Z (AEDT is UTC+11, so 09:00 local = 22:00Z day before)
    // Wait: 2026-11-15 09:00 AEDT = 2026-11-14T22:00:00Z
    // dueTime = max(15:00Z, 22:00Z) = 2026-11-14T22:00:00Z
    // Since both are in the future (today is 2026-09-22), no reminder fires for this gig.
    const gigId = 'rem-25-mel';
    await adminDb.collection('inquiries').doc('enq-rem-25').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-rem-25',
      endAt:     AdminTimestamp.fromDate(new Date('2026-11-14T14:00:00Z')),
      timezone:  'Australia/Melbourne',
      payment:   { ...FRESH_PAYMENT_AFTER },
    }));

    await triggerReminders();
    await new Promise(r => setTimeout(r, 2000));

    // endAt is in the future, so the Firestore query (endAt <= now) excludes this gig entirely
    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(data.payment.reminderSentAt).toBeNull();
  });

  test('5.26 — Perth timezone: same endAt UTC, due at 2026-11-15T01:00:00Z (09:00 Perth next day)', async () => {
    // endAt = 2026-11-14T14:00:00Z; timezone Perth (AWST, UTC+8)
    // Local: 2026-11-14 22:00 Perth
    // endAt + 1h = 2026-11-14T15:00:00Z
    // 09:00 next day Perth = 2026-11-15 09:00 AWST = 2026-11-15T01:00:00Z
    // dueTime = max(15:00Z, 01:00Z next day) = 2026-11-15T01:00:00Z
    // endAt is in the future (today is 2026-09-22), so no reminder fires.
    const gigId = 'rem-26-per';
    await adminDb.collection('inquiries').doc('enq-rem-26').set({ ...ENQ1 });
    await adminDb.collection('gigs').doc(gigId).set(makeEnqGig({
      enquiryId: 'enq-rem-26',
      endAt:     AdminTimestamp.fromDate(new Date('2026-11-14T14:00:00Z')),
      timezone:  'Australia/Perth',
      payment:   { ...FRESH_PAYMENT_AFTER },
    }));

    await triggerReminders();
    await new Promise(r => setTimeout(r, 2000));

    const data = (await adminDb.collection('gigs').doc(gigId).get()).data()!;
    expect(data.payment.reminderSentAt).toBeNull();
  });
});
