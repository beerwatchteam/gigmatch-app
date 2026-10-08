/**
 * Seeds The Coalface timetable with 8 weeks of Friday + Saturday slots.
 * Mix of open and booked-by-fake-acts to look like a real, active venue.
 *
 * Friday Night Live    — 9:00 PM, The Back Room
 * Saturday Night Sessions — 9:30 PM, The Back Room
 *
 * Fake acts booked on some nights (venue_created gigs, no artist profile needed):
 *   The Bottlenecks, Velvet Circuit, Red Shift, Marble Room, Dead Letter Office
 *
 * Usage: node scripts/seedSlots.js
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const VENUE_ID   = 'twaylovenue';
const VENUE_UID  = 'BMWWdoP0S6ZHoKOBJYC6TGGQxAS2';
const VENUE_NAME = 'The Coalface';
const TZ         = 'Australia/Melbourne';

// ── Upcoming Fridays from Oct 9 2026 ─────────────────────────────────────────
const FRIDAYS = [
  { date: '2026-10-09', bookedBy: 'The Bottlenecks' },
  { date: '2026-10-16', bookedBy: null },
  { date: '2026-10-23', bookedBy: null },
  { date: '2026-10-30', bookedBy: 'Dead Letter Office' },
  { date: '2026-11-06', bookedBy: null },
  { date: '2026-11-13', bookedBy: 'Velvet Circuit' },
  { date: '2026-11-20', bookedBy: null },
  { date: '2026-11-27', bookedBy: null },
];

// ── Upcoming Saturdays from Oct 10 2026 ──────────────────────────────────────
const SATURDAYS = [
  { date: '2026-10-10', bookedBy: 'Red Shift' },
  { date: '2026-10-17', bookedBy: null },
  { date: '2026-10-24', bookedBy: null },
  { date: '2026-10-31', bookedBy: 'Marble Room' },
  { date: '2026-11-07', bookedBy: null },
  { date: '2026-11-14', bookedBy: null },
  { date: '2026-11-21', bookedBy: 'Velvet Circuit' },
  { date: '2026-11-28', bookedBy: null },
];

// ── UTC helpers ───────────────────────────────────────────────────────────────
// Melbourne: AEST = UTC+10 (before Oct 5), AEDT = UTC+11 (from Oct 5 2026)
function melbToUtc(localDate, localHHMM) {
  const [y, m, d]    = localDate.split('-').map(Number);
  const [hr, min]    = localHHMM.split(':').map(Number);
  const dstStart     = new Date('2026-10-04T16:00:00Z'); // Oct 5 2026 02:00 AEST
  const localMidUtc  = new Date(Date.UTC(y, m - 1, d, hr, min, 0));
  const offsetHrs    = localMidUtc >= dstStart ? 11 : 10;
  return new Date(localMidUtc.getTime() - offsetHrs * 3_600_000);
}

function makeGigId(date, actName) {
  return 'gig-' + date + '-' + actName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
}

// ── Build a venue_created gig for a fake act ──────────────────────────────────
function makeFakeGigDoc(date, actName, time, nightName) {
  const gigId   = makeGigId(date, actName);
  const startDt = melbToUtc(date, time);
  const endDt   = new Date(startDt.getTime() + 2 * 3_600_000);
  const now     = Timestamp.now();
  return {
    id:          gigId,
    enquiryId:   null,
    venueId:     VENUE_ID,
    venueName:   VENUE_NAME,
    venueUid:    VENUE_UID,
    artistUid:   null,
    artistName:  actName,
    bandName:    actName,
    title:       actName + ' — ' + nightName,
    description: null,
    locationText: null,
    state:       null,
    isPublic:    false,
    status:      'confirmed',
    source:      'venue_created',
    startAt:     Timestamp.fromDate(startDt),
    endAt:       Timestamp.fromDate(endDt),
    timezone:    TZ,
    setLengthMinutes: 90,
    loadInTime:   '19:30',
    soundCheckTime: '20:00',
    room:        'The Back Room',
    fee: {
      type: 'flat', amountCents: null,
      doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null,
    },
    payment: {
      timing: null, timingProposal: null, status: 'not_applicable',
      venueConfirm: null, artistConfirm: null,
      confirmedAmountCents: null, confirmedAt: null,
      reminderSentAt: null, updatedAt: now, dueDate: null,
    },
    participantIds: [VENUE_UID],
    createdBy:    VENUE_UID,
    listAsBooked: true,
    createdAt:    now,
    updatedAt:    now,
  };
}

// ── Build a slot entry ────────────────────────────────────────────────────────
function makeSlot(day, date, time, status, actName, gigId) {
  return {
    day,
    date,
    time,
    room:      'The Back Room',
    status,
    slotType:  'Headline',
    bandName:  actName || null,
    actName:   actName || null,
    gigName:   actName ? actName + ' — ' + (day === 'Friday' ? 'Friday Night Live' : 'Saturday Night Sessions') : null,
    gigId:     gigId   || null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const fridaySlots   = [];
  const saturdaySlots = [];
  const gigDocs       = [];

  for (const f of FRIDAYS) {
    if (f.bookedBy) {
      const gigId = makeGigId(f.date, f.bookedBy);
      gigDocs.push({ id: gigId, doc: makeFakeGigDoc(f.date, f.bookedBy, '21:00', 'Friday Night Live') });
      fridaySlots.push(makeSlot('Friday', f.date, '21:00', 'booked', f.bookedBy, gigId));
      console.log('  Friday', f.date, '— BOOKED by', f.bookedBy);
    } else {
      fridaySlots.push(makeSlot('Friday', f.date, '21:00', 'open', null, null));
      console.log('  Friday', f.date, '— open');
    }
  }

  for (const s of SATURDAYS) {
    if (s.bookedBy) {
      const gigId = makeGigId(s.date, s.bookedBy);
      gigDocs.push({ id: gigId, doc: makeFakeGigDoc(s.date, s.bookedBy, '21:30', 'Saturday Night Sessions') });
      saturdaySlots.push(makeSlot('Saturday', s.date, '21:30', 'booked', s.bookedBy, gigId));
      console.log('  Saturday', s.date, '— BOOKED by', s.bookedBy);
    } else {
      saturdaySlots.push(makeSlot('Saturday', s.date, '21:30', 'open', null, null));
      console.log('  Saturday', s.date, '— open');
    }
  }

  // Write gig docs for fake acts
  const batch = db.batch();
  for (const g of gigDocs) {
    batch.set(db.doc('gigs/' + g.id), g.doc, { merge: true });
  }
  await batch.commit();
  console.log('\n', gigDocs.length, 'fake act gig docs written.');

  // Update venue slots
  await db.doc('venues/' + VENUE_ID).update({
    'slots.Friday':   fridaySlots,
    'slots.Saturday': saturdaySlots,
  });
  console.log('Venue slots updated.\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
