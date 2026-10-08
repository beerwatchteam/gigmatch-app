/**
 * Uploads a local image to Firebase Storage and sets it as the venue's photoUrl.
 * Usage: node scripts/uploadVenuePhoto.js
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage }   = require('firebase-admin/storage');

const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), storageBucket: 'gigmatchweb-aus.firebasestorage.app' });
const db      = getFirestore();
const storage = getStorage().bucket();

const VENUE_ID  = 'b0gYAvjbgfnioRD3z9UN'; // Corner Hotel
const IMAGE_PATH = '/Users/dmaher/Desktop/Corner-Hotel_Andrew-Ashton_CornerHotel_Exterior.webp';
const DEST_PATH  = `venues/${VENUE_ID}/cover.webp`;

async function main() {
  console.log('Uploading', IMAGE_PATH, '...');

  await storage.upload(IMAGE_PATH, {
    destination: DEST_PATH,
    metadata: { contentType: 'image/webp' },
  });

  const file = storage.file(DEST_PATH);
  await file.makePublic();
  const publicUrl = `https://storage.googleapis.com/${storage.name}/${DEST_PATH}`;

  await db.doc('venues/' + VENUE_ID).update({ photoUrl: publicUrl });

  console.log('Done. photoUrl set to:', publicUrl);
}

main().catch(e => { console.error(e); process.exit(1); });
