/**
 * Seeds Faultline enquiries + confirmed gigs into The Coalface's open slots.
 *
 * Booking mix (all Saturdays except one Friday):
 *   Sat Aug 22  — paid      $850
 *   Sat Sep 5   — paid      $1,000
 *   Fri Sep 12  — paid      $780
 *   Sat Sep 19  — overdue   $750   (due Sep 26, now 12 days overdue)
 *   Sat Oct 3   — due       $950   (due Oct 10, 2 days away)
 *   Sat Oct 17  — upcoming  $800
 *   Fri Oct 23  — upcoming  $700
 *   Sat Nov 7   — upcoming  $1,000
 *
 * Usage: node scripts/seedGigs.js
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const ARTIST_UID  = 'YqCguIDfXFUqk8aiwZcvSWrObrr1';
const VENUE_UID   = 'BMWWdoP0S6ZHoKOBJYC6TGGQxAS2';
const VENUE_ID    = 'twaylovenue';
const VENUE_NAME  = 'The Coalface';
const ARTIST_NAME = 'Faultline';
const TZ          = 'Australia/Melbourne';

// ── UTC helpers ───────────────────────────────────────────────────────────────
function melbToUtc(localDate, localHHMM) {
  const [y, m, d]   = localDate.split('-').map(Number);
  const [hr, min]   = localHHMM.split(':').map(Number);
  const dstStart    = new Date('2026-10-04T16:00:00Z'); // Oct 5 02:00 AEST → AEDT
  const local       = new Date(Date.UTC(y, m - 1, d, hr, min, 0));
  const offsetHrs   = local >= dstStart ? 11 : 10;
  return new Date(local.getTime() - offsetHrs * 3_600_000);
}

function ts(isoUtc)  { return Timestamp.fromDate(new Date(isoUtc)); }
function tsD(date)   { return Timestamp.fromDate(melbToUtc(date, '21:30')); }

// ── Booking definitions ───────────────────────────────────────────────────────
// payStatus: 'upcoming' | 'due' | 'overdue' | 'paid'
const BOOKINGS = [
  { id: 'gig-fl-001', date: '2026-08-22', day: 'Saturday', time: '21:30', night: 'Saturday Night Sessions', amountCents: 85000,  payState: 'paid',     dueDate: '2026-08-29' },
  { id: 'gig-fl-002', date: '2026-09-05', day: 'Saturday', time: '21:30', night: 'Saturday Night Sessions', amountCents: 100000, payState: 'paid',     dueDate: '2026-09-12' },
  { id: 'gig-fl-003', date: '2026-09-12', day: 'Friday',   time: '21:00', night: 'Friday Night Live',       amountCents: 78000,  payState: 'paid',     dueDate: '2026-09-19' },
  { id: 'gig-fl-004', date: '2026-09-19', day: 'Saturday', time: '21:30', night: 'Saturday Night Sessions', amountCents: 75000,  payState: 'overdue',  dueDate: '2026-09-26' },
  { id: 'gig-fl-005', date: '2026-10-03', day: 'Saturday', time: '21:30', night: 'Saturday Night Sessions', amountCents: 95000,  payState: 'due',      dueDate: '2026-10-10' },
  { id: 'gig-fl-006', date: '2026-10-17', day: 'Saturday', time: '21:30', night: 'Saturday Night Sessions', amountCents: 80000,  payState: 'upcoming', dueDate: '2026-10-24' },
  { id: 'gig-fl-007', date: '2026-10-23', day: 'Friday',   time: '21:00', night: 'Friday Night Live',       amountCents: 70000,  payState: 'upcoming', dueDate: '2026-10-30' },
  { id: 'gig-fl-008', date: '2026-11-07', day: 'Saturday', time: '21:30', night: 'Saturday Night Sessions', amountCents: 100000, payState: 'upcoming', dueDate: '2026-11-14' },
];

function gigPayment(b, now) {
  if (b.payState === 'paid') {
    const paidAt = ts(b.dueDate + 'T04:00:00Z');
    return {
      timing:               'after',
      timingProposal:       null,
      status:               'confirmed',
      venueConfirm:         { amountCents: b.amountCents, at: paidAt, by: VENUE_UID },
      artistConfirm:        { amountCents: b.amountCents, at: paidAt, by: ARTIST_UID },
      confirmedAmountCents: b.amountCents,
      confirmedAt:          paidAt,
      reminderSentAt:       null,
      updatedAt:            now,
      dueDate:              b.dueDate,
    };
  }
  return {
    timing:               'after',
    timingProposal:       null,
    status:               'pending',
    venueConfirm:         null,
    artistConfirm:        null,
    confirmedAmountCents: null,
    confirmedAt:          null,
    reminderSentAt:       null,
    updatedAt:            now,
    dueDate:              b.payState === 'upcoming' ? b.dueDate : b.dueDate,
  };
}

function makeGigDoc(b) {
  const now     = Timestamp.now();
  const startDt = melbToUtc(b.date, b.time);
  const endDt   = new Date(startDt.getTime() + 2 * 3_600_000);
  return {
    id:          b.id,
    enquiryId:   b.id.replace('gig-', 'enq-'),
    venueId:     VENUE_ID,
    venueName:   VENUE_NAME,
    venueUid:    VENUE_UID,
    artistUid:   ARTIST_UID,
    artistName:  ARTIST_NAME,
    bandName:    ARTIST_NAME,
    title:       ARTIST_NAME + ' — ' + b.night,
    description: null,
    locationText: null,
    state:       null,
    isPublic:    true,
    status:      'confirmed',
    source:      'enquiry',
    startAt:     Timestamp.fromDate(startDt),
    endAt:       Timestamp.fromDate(endDt),
    timezone:    TZ,
    setLengthMinutes: 90,
    loadInTime:   '19:30',
    soundCheckTime: '20:00',
    room:        'The Back Room',
    fee: {
      type:             'flat',
      amountCents:      b.amountCents,
      doorPercent:      null,
      ticketPriceCents: null,
      ticketUrl:        null,
      notes:            null,
    },
    terms: {
      model:       'flat',
      amount:      b.amountCents,
      splitTerms:  null,
      doorPercent: null,
      timing:      'Within 7 days',
      methods:     ['Bank transfer'],
    },
    payment:        gigPayment(b, now),
    participantIds: [ARTIST_UID, VENUE_UID],
    createdBy:      ARTIST_UID,
    listAsBooked:   true,
    createdAt:      now,
    updatedAt:      now,
  };
}

const MESSAGES = [
  "Hey — we'd love to play The Coalface. Big fans of the room and we think our sound is a great fit. We draw 60-100 people consistently across Melbourne's inner north.",
  "Hi, Faultline here. We've been playing Melbourne pubs for four years and we'd love a Saturday night at The Coalface. Happy to discuss fee.",
  "Long-time fans of the room. We reckon our crowd would fill it nicely. Four-piece rock, tight set, reliable.",
];

function makeEnqDoc(b) {
  const now = Timestamp.now();
  const enqId = b.id.replace('gig-', 'enq-');
  const msg   = MESSAGES[BOOKINGS.indexOf(b) % MESSAGES.length];
  return {
    id:          enqId,
    venueId:     VENUE_ID,
    venueName:   VENUE_NAME,
    venueUid:    VENUE_UID,
    createdBy:   ARTIST_UID,
    artistUid:   ARTIST_UID,
    bandName:    ARTIST_NAME,
    status:      'confirmed',
    gigId:       b.id,
    requestedSlot: {
      date:      b.date,
      day:       b.day,
      slotType:  'Headline',
      startTime: b.time === '21:00' ? '9:00 PM' : '9:30 PM',
      room:      'The Back Room',
    },
    confirmedFee: {
      type:        'flat',
      amountCents: b.amountCents,
    },
    message:         msg,
    participantIds:  [ARTIST_UID, VENUE_UID],
    participantUids: [ARTIST_UID, VENUE_UID],
    createdAt:       now,
    updatedAt:       now,
  };
}

function makeSlotEntry(b) {
  return {
    day:      b.day,
    date:     b.date,
    time:     b.time,
    room:     'The Back Room',
    status:   'booked',
    slotType: 'Headline',
    bandName: ARTIST_NAME,
    actName:  ARTIST_NAME,
    gigName:  ARTIST_NAME + ' — ' + b.night,
    gigId:    b.id,
  };
}

async function main() {
  console.log('Writing', BOOKINGS.length, 'Faultline bookings...\n');

  // Write gigs + enquiries in a batch
  const batch = db.batch();
  for (const b of BOOKINGS) {
    batch.set(db.doc('gigs/' + b.id),                        makeGigDoc(b), { merge: true });
    batch.set(db.doc('inquiries/' + b.id.replace('gig-','enq-')), makeEnqDoc(b), { merge: true });
  }
  await batch.commit();

  // Update venue slots — merge new entries into existing day arrays
  const venueSnap = await db.doc('venues/' + VENUE_ID).get();
  const slots     = { ...(venueSnap.data()?.slots || {}) };

  for (const b of BOOKINGS) {
    const day     = b.day;
    const dayArr  = [...(slots[day] || [])];

    // Remove any existing entry for this date (open or old booking)
    const filtered = dayArr.filter(s => s.date !== b.date);
    filtered.push(makeSlotEntry(b));
    // Keep sorted by date
    filtered.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    slots[day] = filtered;

    const dollars = '$' + (b.amountCents / 100).toLocaleString();
    console.log(' ', b.day.padEnd(9), b.date, '|', dollars.padEnd(7), '|', b.payState);
  }

  await db.doc('venues/' + VENUE_ID).update({ slots });
  console.log('\nVenue slots updated.\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
