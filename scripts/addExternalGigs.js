/**
 * Re-adds the 3 external (non-Twaylo) Faultline gigs back to the `gigs`
 * collection as manually-added paid gigs, with fake fee amounts.
 * These were deleted when reassigned to external venues.
 *
 * Usage: node scripts/addExternalGigs.js
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const ARTIST_UID  = 'YqCguIDfXFUqk8aiwZcvSWrObrr1';
const TZ          = 'Australia/Melbourne';

function melbToUtc(localDate, localHHMM) {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hr, min] = localHHMM.split(':').map(Number);
  const dstStart  = new Date('2026-10-04T16:00:00Z');
  const local     = new Date(Date.UTC(y, m - 1, d, hr, min, 0));
  const offsetHrs = local >= dstStart ? 11 : 10;
  return new Date(local.getTime() - offsetHrs * 3_600_000);
}

const GIGS = [
  { id: 'gig-fl-001', date: '2026-08-22', time: '21:30', venueName: 'The Ironworks',   suburb: 'Collingwood', amountCents: 85000,  dueDate: '2026-08-29' },
  { id: 'gig-fl-002', date: '2026-09-05', time: '21:30', venueName: 'Copper Lane Bar', suburb: 'Fitzroy',     amountCents: 92000,  dueDate: '2026-09-12' },
  { id: 'gig-fl-003', date: '2026-09-12', time: '21:00', venueName: 'The Foundry',     suburb: 'Brunswick',   amountCents: 78000,  dueDate: '2026-09-19' },
];

async function main() {
  const batch = db.batch();
  const now   = Timestamp.now();

  for (const g of GIGS) {
    const startDt = melbToUtc(g.date, g.time);
    const endDt   = new Date(startDt.getTime() + 2 * 3_600_000);
    const paidAt  = Timestamp.fromDate(new Date(g.dueDate + 'T04:00:00Z'));

    batch.set(db.doc('gigs/' + g.id), {
      id:           g.id,
      enquiryId:    null,
      venueId:      null,
      venueName:    g.venueName,
      venueUid:     null,
      artistUid:    ARTIST_UID,
      artistName:   'Faultline',
      bandName:     'Faultline',
      title:        'Faultline',
      description:  null,
      locationText: g.suburb + ', VIC',
      state:        'VIC',
      isPublic:     true,
      status:       'confirmed',
      source:       'added_by_you',
      startAt:      Timestamp.fromDate(startDt),
      endAt:        Timestamp.fromDate(endDt),
      timezone:     TZ,
      setLengthMinutes: 90,
      loadInTime:   '19:30',
      soundCheckTime: '20:00',
      room:         null,
      fee: {
        type:             'flat',
        amountCents:      g.amountCents,
        doorPercent:      null,
        ticketPriceCents: null,
        ticketUrl:        null,
        notes:            null,
      },
      payment: {
        timing:               'after',
        timingProposal:       null,
        status:               'confirmed',
        venueConfirm:         { amountCents: g.amountCents, at: paidAt, by: ARTIST_UID },
        artistConfirm:        { amountCents: g.amountCents, at: paidAt, by: ARTIST_UID },
        confirmedAmountCents: g.amountCents,
        confirmedAt:          paidAt,
        reminderSentAt:       null,
        updatedAt:            now,
        dueDate:              g.dueDate,
      },
      participantIds: [ARTIST_UID],
      createdBy:      ARTIST_UID,
      listAsBooked:   true,
      createdAt:      now,
      updatedAt:      now,
    }, { merge: true });

    const dollars = '$' + (g.amountCents / 100).toLocaleString();
    console.log(' ', g.date, g.venueName.padEnd(20), dollars, '— paid');
  }

  await batch.commit();
  console.log('\nExternal gigs added to gigs collection with payment data.');
}

main().catch(e => { console.error(e); process.exit(1); });
