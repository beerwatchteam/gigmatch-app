/**
 * Reassigns 3 of Faultline's past gigs to different (non-Twaylo) venues.
 * Updates publicGigs so they appear on the Shows & Availability tab with
 * the new venue names, and deletes the corresponding gigs + inquiries docs
 * so they don't appear in the Twaylo enquiry inbox.
 *
 * Usage: node scripts/reassignPastGigs.js
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

// Gigs to reassign — pick 3 past ones (Aug 22, Sep 5, Sep 12)
const REASSIGN = [
  { gigId: 'gig-fl-001', venueName: 'The Ironworks',    venueId: null, room: 'Main Stage' },
  { gigId: 'gig-fl-002', venueName: 'Copper Lane Bar',  venueId: null, room: 'Bar Stage'  },
  { gigId: 'gig-fl-003', venueName: 'The Foundry',      venueId: null, room: 'Back Room'  },
];

async function main() {
  const batch = db.batch();

  for (const r of REASSIGN) {
    // Update publicGigs doc — change venue info, clear Twaylo linkage
    batch.update(db.doc('publicGigs/' + r.gigId), {
      venueName:    r.venueName,
      venueId:      r.venueId,
      room:         r.room,
      source:       'external',
    });

    // Delete from gigs collection
    batch.delete(db.doc('gigs/' + r.gigId));

    // Delete from inquiries collection
    batch.delete(db.doc('inquiries/enq-' + r.gigId.replace('gig-', '')));

    console.log(' ', r.gigId, '→', r.venueName);
  }

  await batch.commit();
  console.log('\nDone. 3 past gigs reassigned, removed from gigs + inquiries.');
}

main().catch(e => { console.error(e); process.exit(1); });
