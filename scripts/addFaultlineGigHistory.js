/**
 * Adds 3 manually-logged past gigs to Faultline's bandProfile gigHistory.
 * These appear in the "My Gigs" section under "Gig history" —
 * the same place as the "+ Add gig" feature.
 *
 * Usage: node scripts/addFaultlineGigHistory.js
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const ARTIST_UID = 'YqCguIDfXFUqk8aiwZcvSWrObrr1';

const HISTORY = [
  { venue: 'The Ironworks',   suburb: 'Collingwood',  date: '2026-08-22', attendance: '85',  notes: 'Great night, packed room.' },
  { venue: 'Copper Lane Bar', suburb: 'Fitzroy',      date: '2026-09-05', attendance: '70',  notes: '' },
  { venue: 'The Foundry',     suburb: 'Brunswick',    date: '2026-09-12', attendance: '60',  notes: 'Friday Night Live slot.' },
];

async function main() {
  await db.doc('bandProfiles/' + ARTIST_UID).update({
    gigHistory: FieldValue.arrayUnion(...HISTORY),
  });

  console.log('Added to gigHistory:');
  HISTORY.forEach(g => console.log(' ', g.date, g.venue, g.suburb));
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
