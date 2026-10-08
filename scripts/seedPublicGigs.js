/**
 * Writes publicGigs collection docs for Faultline's confirmed gigs.
 * Normally these are written by a Cloud Function trigger on gig confirmation.
 * Since we seeded gigs directly, we write them manually here.
 *
 * The musician profile's Shows & Availability tab reads from:
 *   collection('publicGigs') where artistUid == id
 *
 * Usage: node scripts/seedPublicGigs.js
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
const VENUE_ID    = 'twaylovenue';
const VENUE_NAME  = 'The Coalface';
const ARTIST_NAME = 'Faultline';
const TZ          = 'Australia/Melbourne';

function melbToUtc(localDate, localHHMM) {
  const [y, m, d]   = localDate.split('-').map(Number);
  const [hr, min]   = localHHMM.split(':').map(Number);
  const dstStart    = new Date('2026-10-04T16:00:00Z');
  const local       = new Date(Date.UTC(y, m - 1, d, hr, min, 0));
  const offsetHrs   = local >= dstStart ? 11 : 10;
  return new Date(local.getTime() - offsetHrs * 3_600_000);
}

// All 8 Faultline gigs
const GIGS = [
  { id: 'gig-fl-001', date: '2026-08-22', time: '21:30', night: 'Saturday Night Sessions' },
  { id: 'gig-fl-002', date: '2026-09-05', time: '21:30', night: 'Saturday Night Sessions' },
  { id: 'gig-fl-003', date: '2026-09-12', time: '21:00', night: 'Friday Night Live'       },
  { id: 'gig-fl-004', date: '2026-09-19', time: '21:30', night: 'Saturday Night Sessions' },
  { id: 'gig-fl-005', date: '2026-10-03', time: '21:30', night: 'Saturday Night Sessions' },
  { id: 'gig-fl-006', date: '2026-10-17', time: '21:30', night: 'Saturday Night Sessions' },
  { id: 'gig-fl-007', date: '2026-10-23', time: '21:00', night: 'Friday Night Live'       },
  { id: 'gig-fl-008', date: '2026-11-07', time: '21:30', night: 'Saturday Night Sessions' },
];

async function main() {
  const batch = db.batch();

  for (const g of GIGS) {
    const startDt = melbToUtc(g.date, g.time);
    const endDt   = new Date(startDt.getTime() + 2 * 3_600_000);

    // publicGigs doc ID matches the gig ID for easy cross-referencing
    const ref = db.doc('publicGigs/' + g.id);
    batch.set(ref, {
      gigId:            g.id,
      artistUid:        ARTIST_UID,
      venueId:          VENUE_ID,
      title:            ARTIST_NAME + ' — ' + g.night,
      actName:          ARTIST_NAME,
      venueName:        VENUE_NAME,
      room:             'The Back Room',
      locationText:     null,
      state:            null,
      date:             g.date,
      startAt:          Timestamp.fromDate(startDt),
      endAt:            Timestamp.fromDate(endDt),
      timezone:         TZ,
      description:      null,
      ticketUrl:        null,
      ticketPriceCents: null,
      source:           'enquiry',
      status:           'confirmed',
    }, { merge: true });

    const isFuture = new Date(g.date) > new Date('2026-10-08');
    console.log(' ', g.date, g.night.padEnd(26), isFuture ? 'upcoming' : 'past');
  }

  await batch.commit();
  console.log('\npublicGigs written for Faultline. Shows & Availability tab should now populate.');
}

main().catch(e => { console.error(e); process.exit(1); });
