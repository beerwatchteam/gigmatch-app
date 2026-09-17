/**
 * Deletes all venues from Firestore EXCEPT "Example Venue".
 *
 * Run this before importLMLVenues.js to start fresh.
 *
 * Usage:
 *   node scripts/clearVenues.js
 *
 * Requires: scripts/serviceAccountKey.json
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const keyPath = resolve(__dirname, 'scripts1serviceAccountKey.json');
let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch {
  console.error(
    '\nERROR: Service account key not found.\n' +
    'Save it as: scripts/scripts1serviceAccountKey.json\n',
  );
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const KEEP = ['example venue'];

async function main() {
  console.log('─'.repeat(52));
  console.log('  GigMatch — Clear Venues (keep: Example Venue)');
  console.log('─'.repeat(52));

  const snapshot = await db.collection('venues').get();
  console.log(`\nFound ${snapshot.size} venue(s).`);

  const toDelete = snapshot.docs.filter(d => {
    const name = (d.data().name ?? '').toLowerCase().trim();
    return !KEEP.includes(name);
  });

  const toKeep = snapshot.size - toDelete.length;
  console.log(`Keeping: ${toKeep}  |  Deleting: ${toDelete.length}\n`);

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    process.exit(0);
  }

  let deleted = 0;
  for (const doc of toDelete) {
    console.log(`  - "${doc.data().name}" (${doc.id})`);
    await doc.ref.delete();
    deleted++;
  }

  console.log('\n' + '─'.repeat(52));
  console.log(`  Done. Deleted ${deleted} venue(s).`);
  console.log('─'.repeat(52) + '\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err);
  process.exit(1);
});
