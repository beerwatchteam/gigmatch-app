/**
 * Firestore security rules tests — section 2 of the test brief.
 *
 * REQUIRES: Firestore + Auth emulators running on their configured ports.
 *   firebase emulators:start --only firestore,auth
 *
 * Run via: npm run test:rules
 * (which wraps this in firebase emulators:exec)
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  setDoc, doc, getDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs,
} from 'firebase/firestore';
import { UID, USERS, GIG_ENQ1, GIG_ARTIST_ADDED, GIG_VENUE_CREATED, ENQ1, FRESH_PAYMENT_BEFORE, FRESH_PAYMENT_AFTER, FRESH_PAYMENT_SINGLE } from '../seed';

const PROJECT_ID = 'gigmatchweb-aus-test-rules';
const RULES_PATH = resolve(__dirname, '../../firestore.rules');

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host:  'localhost',
      port:  8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  // Seed users and required prerequisite docs using Admin SDK access
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Users
    for (const [uid, data] of Object.entries(USERS)) {
      await db.collection('users').doc(uid).set(data);
    }

    // Venues
    await db.collection('venues').doc('v1').set({ name: 'Test Venue 1', state: 'VIC' });
    await db.collection('venues').doc('v2').set({ name: 'Test Venue 2', state: 'WA' });

    // Enquiry doc (needed for the enquiry gig create rules)
    await db.collection('inquiries').doc('enq1').set({
      ...ENQ1,
    });

    // Pre-existing gig docs for read/update/delete tests
    await db.collection('gigs').doc('enq1').set(GIG_ENQ1);
    await db.collection('gigs').doc('artist-gig-1').set(GIG_ARTIST_ADDED);
    await db.collection('gigs').doc('venue-gig-1').set(GIG_VENUE_CREATED);

    // Separate inquiry docs for create tests (gig ID must match inquiry ID for the rules get() call)
    await db.collection('inquiries').doc('enq-create-test').set({ ...ENQ1 });
    await db.collection('inquiries').doc('enq1-extra').set({ ...ENQ1 });
    await db.collection('inquiries').doc('enq1-mismatch').set({ ...ENQ1 });
    await db.collection('inquiries').doc('enq1-v2').set({ ...ENQ1 });
    await db.collection('inquiries').doc('vc-new-1').set({ ...ENQ1 });
    await db.collection('inquiries').doc('vc-new-2').set({ ...ENQ1 });
    await db.collection('inquiries').doc('vc-new-3').set({ ...ENQ1 });

    // Pre-existing publicGigs for unauthenticated read test
    await db.collection('publicGigs').doc('pub1').set({
      gigId: 'pub1', artistUid: UID.artistA, source: 'artist_added',
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function db(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}
function unauthDb() {
  return testEnv.unauthenticatedContext().firestore();
}

// ── Create: artist_added ──────────────────────────────────────────────────────

test('1 — artistA creates artist_added gig with participantIds [artistA]', async () => {
  await assertSucceeds(
    setDoc(doc(db(UID.artistA), 'gigs', 'g-new-1'), {
      source:        'artist_added',
      createdBy:     UID.artistA,
      artistUid:     UID.artistA,
      venueUid:      UID.artistA,
      venueId:       null,
      participantIds: [UID.artistA],
      isPublic:      false,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_SINGLE,
    })
  );
});

test('2 — artistA denied: participantIds includes stranger', async () => {
  await assertFails(
    setDoc(doc(db(UID.artistA), 'gigs', 'g-new-2'), {
      source:        'artist_added',
      createdBy:     UID.artistA,
      artistUid:     UID.artistA,
      venueUid:      UID.artistA,
      venueId:       null,
      participantIds: [UID.artistA, UID.stranger],
      isPublic:      false,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_SINGLE,
    })
  );
});

test('3 — artistA denied: createdBy = artistB', async () => {
  await assertFails(
    setDoc(doc(db(UID.artistA), 'gigs', 'g-new-3'), {
      source:        'artist_added',
      createdBy:     UID.artistB,
      artistUid:     UID.artistA,
      venueUid:      UID.artistA,
      venueId:       null,
      participantIds: [UID.artistA],
      isPublic:      false,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_SINGLE,
    })
  );
});

// ── Create: enquiry ───────────────────────────────────────────────────────────

test('4 — venueOwner1 creates enquiry gig with venueId v1, participantIds [artistA, venueOwner1]', async () => {
  // Use 'enq-create-test' so it doesn't collide with the pre-seeded gigs/enq1 doc.
  // The Firestore rule does get(inquiries/$(gigId)), so a matching inquiry doc must exist.
  await assertSucceeds(
    setDoc(doc(db(UID.venueOwner1), 'gigs', 'enq-create-test'), {
      source:        'enquiry',
      createdBy:     UID.venueOwner1,
      venueId:       'v1',
      venueUid:      UID.venueOwner1,
      artistUid:     UID.artistA,
      participantIds: [UID.artistA, UID.venueOwner1],
      isPublic:      false,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_BEFORE,
    })
  );
});

test('5 — venueOwner1 denied: participantIds has 3 entries', async () => {
  await assertFails(
    setDoc(doc(db(UID.venueOwner1), 'gigs', 'enq1-extra'), {
      source:        'enquiry',
      createdBy:     UID.venueOwner1,
      venueId:       'v1',
      venueUid:      UID.venueOwner1,
      artistUid:     UID.artistA,
      participantIds: [UID.artistA, UID.venueOwner1, UID.stranger],
      isPublic:      false,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_BEFORE,
    })
  );
});

test('6 — venueOwner2 denied: creating gig with venueId v1 (not their venue)', async () => {
  await assertFails(
    setDoc(doc(db(UID.venueOwner2), 'gigs', 'enq1-v2'), {
      source:        'enquiry',
      createdBy:     UID.venueOwner2,
      venueId:       'v1',
      venueUid:      UID.venueOwner2,
      artistUid:     UID.artistA,
      participantIds: [UID.artistA, UID.venueOwner2],
      isPublic:      false,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_BEFORE,
    })
  );
});

test('7 — venueOwner1 denied: artistUid = artistB (mismatch with enquiry createdBy)', async () => {
  await assertFails(
    setDoc(doc(db(UID.venueOwner1), 'gigs', 'enq1-mismatch'), {
      source:        'enquiry',
      createdBy:     UID.venueOwner1,
      venueId:       'v1',
      venueUid:      UID.venueOwner1,
      artistUid:     UID.artistB, // does not match inquiries/enq1.createdBy = artistA
      participantIds: [UID.artistB, UID.venueOwner1],
      isPublic:      false,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_BEFORE,
    })
  );
});

// ── Create: venue_created ─────────────────────────────────────────────────────

test('8 — venueOwner1 creates venue_created gig, isPublic false', async () => {
  await assertSucceeds(
    setDoc(doc(db(UID.venueOwner1), 'gigs', 'vc-new-1'), {
      source:        'venue_created',
      createdBy:     UID.venueOwner1,
      venueId:       'v1',
      venueUid:      UID.venueOwner1,
      artistUid:     null,
      participantIds: [UID.venueOwner1],
      isPublic:      false,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_SINGLE,
    })
  );
});

test('9 — venueOwner1 denied: venue_created with isPublic true', async () => {
  await assertFails(
    setDoc(doc(db(UID.venueOwner1), 'gigs', 'vc-new-2'), {
      source:        'venue_created',
      createdBy:     UID.venueOwner1,
      venueId:       'v1',
      venueUid:      UID.venueOwner1,
      artistUid:     null,
      participantIds: [UID.venueOwner1],
      isPublic:      true,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_SINGLE,
    })
  );
});

test('10 — venueOwner1 denied: venue_created with venueId v2', async () => {
  await assertFails(
    setDoc(doc(db(UID.venueOwner1), 'gigs', 'vc-new-3'), {
      source:        'venue_created',
      createdBy:     UID.venueOwner1,
      venueId:       'v2',
      venueUid:      UID.venueOwner1,
      artistUid:     null,
      participantIds: [UID.venueOwner1],
      isPublic:      false,
      status:        'confirmed',
      payment:       FRESH_PAYMENT_SINGLE,
    })
  );
});

// ── Read ──────────────────────────────────────────────────────────────────────

test('11 — artistA reads own gig (participant)', async () => {
  await assertSucceeds(getDoc(doc(db(UID.artistA), 'gigs', 'enq1')));
});

test('12 — stranger denied: read gigs/enq1 (not a participant)', async () => {
  await assertFails(getDoc(doc(db(UID.stranger), 'gigs', 'enq1')));
});

test('13 — stranger denied: query gigs with no array-contains filter', async () => {
  // Without a filter, Firestore would try to return docs the user can't read
  await assertFails(getDocs(query(collection(db(UID.stranger), 'gigs'))));
});

test('14 — artistA can query gigs with array-contains artistA', async () => {
  await assertSucceeds(
    getDocs(
      query(
        collection(db(UID.artistA), 'gigs'),
        where('participantIds', 'array-contains', UID.artistA),
      )
    )
  );
});

test('15 — admin reads any gig', async () => {
  await assertSucceeds(getDoc(doc(db(UID.admin), 'gigs', 'enq1')));
  await assertSucceeds(getDoc(doc(db(UID.admin), 'gigs', 'artist-gig-1')));
});

// ── Update ────────────────────────────────────────────────────────────────────

test('16 — artistA denied: update enq1 changing participantIds', async () => {
  await assertFails(
    updateDoc(doc(db(UID.artistA), 'gigs', 'enq1'), {
      participantIds: [UID.artistA], // changed (removed venueOwner1)
    })
  );
});

test('17 — artistA allowed: update enq1 isPublic false → true (artistUid match)', async () => {
  await assertSucceeds(
    updateDoc(doc(db(UID.artistA), 'gigs', 'enq1'), {
      ...GIG_ENQ1,
      isPublic: true,
    })
  );
});

test('18 — venueOwner1 denied: update enq1 isPublic (not the artistUid)', async () => {
  await assertFails(
    updateDoc(doc(db(UID.venueOwner1), 'gigs', 'enq1'), {
      ...GIG_ENQ1,
      isPublic: true,
    })
  );
});

test('19 — venueOwner1 allowed: update enq1 title and description', async () => {
  await assertSucceeds(
    updateDoc(doc(db(UID.venueOwner1), 'gigs', 'enq1'), {
      ...GIG_ENQ1,
      title:       'Updated Title',
      description: 'Updated description',
    })
  );
});

// ── Delete ────────────────────────────────────────────────────────────────────

test('20 — artistA can delete their own artist_added gig', async () => {
  await assertSucceeds(deleteDoc(doc(db(UID.artistA), 'gigs', 'artist-gig-1')));
});

test('21 — artistA denied: delete enquiry gig (source != artist_added)', async () => {
  await assertFails(deleteDoc(doc(db(UID.artistA), 'gigs', 'enq1')));
});

test('22 — venueOwner1 denied: delete venue_created gig (cancel only, not hard delete)', async () => {
  await assertFails(deleteDoc(doc(db(UID.venueOwner1), 'gigs', 'venue-gig-1')));
});

// ── Private subcollection ─────────────────────────────────────────────────────

test('23 — artistA writes gigs/enq1/private/artistA (participant, uid match)', async () => {
  await assertSucceeds(
    setDoc(
      doc(db(UID.artistA), 'gigs', 'enq1', 'private', UID.artistA),
      { ownerUid: UID.artistA, notes: 'test', docs: [], updatedAt: new Date() }
    )
  );
});

test('24 — venueOwner1 denied: read gigs/enq1/private/artistA (uid mismatch)', async () => {
  // Seed the private doc first
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore()
      .collection('gigs').doc('enq1')
      .collection('private').doc(UID.artistA)
      .set({ ownerUid: UID.artistA, notes: 'secret', docs: [] });
  });
  await assertFails(
    getDoc(doc(db(UID.venueOwner1), 'gigs', 'enq1', 'private', UID.artistA))
  );
});

test('25 — stranger denied: write gigs/enq1/private/stranger (not a participant)', async () => {
  await assertFails(
    setDoc(
      doc(db(UID.stranger), 'gigs', 'enq1', 'private', UID.stranger),
      { ownerUid: UID.stranger, notes: 'hack', docs: [] }
    )
  );
});

// ── publicGigs ────────────────────────────────────────────────────────────────

test('26 — any authenticated user denied: write publicGigs/*', async () => {
  await assertFails(
    setDoc(doc(db(UID.artistA), 'publicGigs', 'fake-gig'), { gigId: 'fake' })
  );
});

test('27 — unauthenticated read publicGigs/* is allowed', async () => {
  await assertSucceeds(getDoc(doc(unauthDb(), 'publicGigs', 'pub1')));
});

// Test 28 (calendarFeeds) skipped — only applies once step 2a (calendar feed auth) exists.

// ── Payment rules ─────────────────────────────────────────────────────────────

// Shared base for enquiry gig creates in payment tests
const BASE_ENQ_GIG = {
  source:        'enquiry',
  createdBy:     UID.venueOwner1,
  venueId:       'v1',
  venueUid:      UID.venueOwner1,
  artistUid:     UID.artistA,
  participantIds: [UID.artistA, UID.venueOwner1],
  isPublic:      false,
  status:        'confirmed',
} as const;

test('28 — venueOwner1 denied: create enquiry gig with payment.status confirmed', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('inquiries').doc('enq-pay-28').set({ ...ENQ1 });
  });
  await assertFails(
    setDoc(doc(db(UID.venueOwner1), 'gigs', 'enq-pay-28'), {
      ...BASE_ENQ_GIG,
      payment: { ...FRESH_PAYMENT_BEFORE, status: 'confirmed' },
    })
  );
});

test('29 — venueOwner1 denied: create enquiry gig with non-null venueConfirm', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('inquiries').doc('enq-pay-29').set({ ...ENQ1 });
  });
  await assertFails(
    setDoc(doc(db(UID.venueOwner1), 'gigs', 'enq-pay-29'), {
      ...BASE_ENQ_GIG,
      payment: {
        ...FRESH_PAYMENT_BEFORE,
        venueConfirm: { amountCents: 40000, at: new Date(), by: UID.venueOwner1 },
      },
    })
  );
});

test('30 — venueOwner1 allowed: create enquiry gig with fresh payment timing after', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('inquiries').doc('enq-pay-30').set({ ...ENQ1 });
  });
  await assertSucceeds(
    setDoc(doc(db(UID.venueOwner1), 'gigs', 'enq-pay-30'), {
      ...BASE_ENQ_GIG,
      payment: FRESH_PAYMENT_AFTER,
    })
  );
});

test('31 — artistA denied: update payment.venueConfirm directly on enquiry gig', async () => {
  await assertFails(
    updateDoc(doc(db(UID.artistA), 'gigs', 'enq1'), {
      ...GIG_ENQ1,
      'payment.venueConfirm': { amountCents: 40000, at: new Date(), by: UID.artistA },
    })
  );
});

test('32 — venueOwner1 denied: update payment.status directly on enquiry gig', async () => {
  await assertFails(
    updateDoc(doc(db(UID.venueOwner1), 'gigs', 'enq1'), {
      ...GIG_ENQ1,
      'payment.status': 'confirmed',
    })
  );
});

test('33 — venueOwner1 denied: update fee directly on enquiry gig', async () => {
  await assertFails(
    updateDoc(doc(db(UID.venueOwner1), 'gigs', 'enq1'), {
      ...GIG_ENQ1,
      fee: { ...GIG_ENQ1.fee, amountCents: 50000 },
    })
  );
});

test('34 — artistA allowed: update fee directly on artist_added gig', async () => {
  await assertSucceeds(
    updateDoc(doc(db(UID.artistA), 'gigs', 'artist-gig-1'), {
      ...GIG_ARTIST_ADDED,
      fee: { ...GIG_ARTIST_ADDED.fee, amountCents: 20000 },
    })
  );
});

test('35 — ordinary edit (toggle isPublic) still passes with payment untouched', async () => {
  // artistA toggles isPublic true — payment unchanged, should succeed
  await assertSucceeds(
    updateDoc(doc(db(UID.artistA), 'gigs', 'enq1'), {
      ...GIG_ENQ1,
      isPublic: true,
    })
  );
});

test('36 — re-accept cancelled gig with fresh payment: allow when payment was pending', async () => {
  // Seed a cancelled enquiry gig with pending payment
  const gigId = 'enq-reaccept-36';
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db2 = ctx.firestore();
    await db2.collection('inquiries').doc(gigId).set({ ...ENQ1 });
    await db2.collection('gigs').doc(gigId).set({
      ...GIG_ENQ1,
      status:  'cancelled',
      payment: FRESH_PAYMENT_BEFORE, // status: pending
    });
  });
  await assertSucceeds(
    updateDoc(doc(db(UID.venueOwner1), 'gigs', gigId), {
      ...GIG_ENQ1,
      status:  'confirmed',
      payment: FRESH_PAYMENT_AFTER, // fresh, new timing
    })
  );
});

test('37 — re-accept cancelled gig: deny when payment was already confirmed', async () => {
  const gigId = 'enq-reaccept-37';
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db2 = ctx.firestore();
    await db2.collection('inquiries').doc(gigId).set({ ...ENQ1 });
    await db2.collection('gigs').doc(gigId).set({
      ...GIG_ENQ1,
      status: 'cancelled',
      payment: {
        ...FRESH_PAYMENT_BEFORE,
        status:               'confirmed',
        confirmedAmountCents: 40000,
        confirmedAt:          new Date(),
        venueConfirm:  { amountCents: 40000, at: new Date(), by: UID.venueOwner1 },
        artistConfirm: { amountCents: 40000, at: new Date(), by: UID.artistA },
      },
    });
  });
  await assertFails(
    updateDoc(doc(db(UID.venueOwner1), 'gigs', gigId), {
      ...GIG_ENQ1,
      status:  'confirmed',
      payment: FRESH_PAYMENT_BEFORE,
    })
  );
});
