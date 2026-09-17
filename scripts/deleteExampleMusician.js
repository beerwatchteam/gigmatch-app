/**
 * Deletes the "Example Musician" artist account from Firestore and Firebase Auth.
 *
 * Usage:
 *   node scripts/deleteExampleMusician.js
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const serviceAccount = JSON.parse(
  readFileSync(resolve(__dirname, 'scripts1serviceAccountKey.json'), 'utf8')
);

initializeApp({ credential: cert(serviceAccount) });

const db   = getFirestore();
const auth = getAuth();

async function run() {
  // Try both possible spellings
  let found = [];
  for (const name of ['Example Musicina', 'Example Musician']) {
    const snap = await db.collection('bandProfiles').where('name', '==', name).get();
    snap.docs.forEach(d => found.push(d));
  }

  // Deduplicate by doc id
  const seen = new Set();
  found = found.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });

  if (found.length === 0) {
    console.log('No matching bandProfile found. Check the name and try again.');
    return;
  }

  for (const doc of found) {
    const uid  = doc.id;
    const name = doc.data().name;
    console.log(`Found: ${name} (uid: ${uid})`);

    await db.collection('bandProfiles').doc(uid).delete();
    console.log(`  Deleted bandProfiles/${uid}`);

    try {
      await db.collection('users').doc(uid).delete();
      console.log(`  Deleted users/${uid}`);
    } catch {
      console.log(`  users/${uid} not found or already deleted`);
    }

    try {
      await auth.deleteUser(uid);
      console.log(`  Deleted Auth user ${uid}`);
    } catch {
      console.log(`  Auth user ${uid} not found or already deleted`);
    }

    console.log(`Done — ${name} removed.`);
  }
}

run().catch(console.error);
