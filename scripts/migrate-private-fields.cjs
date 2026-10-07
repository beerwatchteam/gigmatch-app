/**
 * migrate-private-fields.cjs
 *
 * Moves sensitive fields from public Firestore documents to their private
 * subcollections for all venues and artist profiles.
 *
 * Dry-run by default. Pass --apply to write changes.
 *
 * Usage:
 *   node scripts/migrate-private-fields.cjs           # dry run
 *   node scripts/migrate-private-fields.cjs --apply   # live run
 */

'use strict';

const { initializeApp, cert } = require('/Users/dmaher/Desktop/gigmatch-app/node_modules/firebase-admin/lib/index.js');
const { getFirestore, FieldValue } = require('/Users/dmaher/Desktop/gigmatch-app/node_modules/firebase-admin/lib/firestore/index.js');
const path = require('path');

const SA_KEY = path.join(__dirname, 'scripts1serviceAccountKey.json');
const APPLY  = process.argv.includes('--apply');

if (!APPLY) {
  console.log('DRY RUN — pass --apply to write changes\n');
} else {
  console.log('LIVE RUN — changes will be written\n');
}

const app = initializeApp({ credential: cert(require(SA_KEY)) });
const db  = getFirestore(app);

// ── Venue private fields ─────────────────────────────────────────────────────
const VENUE_PRIVATE_FIELDS = [
  'email', 'bookingContactName', 'bookingContactPhone',
  'accountsContactName', 'accountsContactEmail',
  'legalEntityName', 'invoicingNotes',
];

// ── Artist private payment fields ────────────────────────────────────────────
const ARTIST_PRIVATE_PAY = [
  'abn', 'abnStatus', 'methods', 'invoicingName',
  'timing', 'timingOther', 'paymentNotes', 'insuranceCertAvailable',
];
const ARTIST_PRIVATE_TOP = ['email', 'phone'];

async function migrateVenues() {
  const snap = await db.collection('venues').get();
  console.log(`Found ${snap.size} venue docs`);
  let moved = 0, skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const privateData = {};
    const publicDeletions = {};

    for (const field of VENUE_PRIVATE_FIELDS) {
      const val = data[field];
      if (val !== undefined && val !== null && val !== '') {
        privateData[field] = val;
        publicDeletions[field] = FieldValue.delete();
      }
    }

    if (Object.keys(privateData).length === 0) {
      skipped++;
      continue;
    }

    privateData.updatedAt = Date.now();
    privateData.migratedAt = new Date().toISOString();

    // Set public boolean indicator so venues list filter still works
    const publicUpdates = { ...publicDeletions, hasBookingContact: !!(data.email && data.email.trim()) };

    console.log(`  VENUE ${docSnap.id} (${data.name || 'unnamed'})`);
    console.log(`    moving: ${Object.keys(privateData).filter(k => k !== 'updatedAt' && k !== 'migratedAt').join(', ')}`);

    if (APPLY) {
      await db.doc(`venues/${docSnap.id}/private/details`).set(privateData, { merge: true });
      await db.doc(`venues/${docSnap.id}`).update(publicUpdates);
      console.log('    written');
    }
    moved++;
  }

  console.log(`\nVenues: ${moved} to migrate, ${skipped} skipped (no private data)\n`);
}

async function migrateArtists() {
  const snap = await db.collection('bandProfiles').get();
  console.log(`Found ${snap.size} bandProfile docs`);
  let moved = 0, skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const privateDetails = {};
    const publicUpdates = {};

    // Top-level private fields
    for (const field of ARTIST_PRIVATE_TOP) {
      const val = data[field];
      if (val !== undefined && val !== null && val !== '') {
        privateDetails[field] = val;
        publicUpdates[field] = FieldValue.delete();
      }
    }

    // Hospitality
    if (data.hospitality && Object.keys(data.hospitality).length > 0) {
      privateDetails.hospitality = data.hospitality;
      publicUpdates.hospitality = FieldValue.delete();
    }

    // Payment private fields
    if (data.payment) {
      const privatePayment = {};
      for (const field of ARTIST_PRIVATE_PAY) {
        if (data.payment[field] !== undefined) {
          privatePayment[field] = data.payment[field];
        }
      }
      if (Object.keys(privatePayment).length > 0) {
        privateDetails.payment = privatePayment;
        const cleanAbn = (data.payment.abn || '').replace(/\s/g, '');
        publicUpdates['payment.hasAbn'] = data.payment.abnStatus === 'has_abn' && !!cleanAbn;
        for (const field of ARTIST_PRIVATE_PAY) {
          publicUpdates[`payment.${field}`] = FieldValue.delete();
        }
      }
    }

    if (Object.keys(privateDetails).length === 0) {
      skipped++;
      continue;
    }

    privateDetails.updatedAt = Date.now();
    privateDetails.migratedAt = new Date().toISOString();

    console.log(`  ARTIST ${docSnap.id} (${data.name || 'unnamed'})`);
    console.log(`    moving: ${Object.keys(privateDetails).filter(k => k !== 'updatedAt' && k !== 'migratedAt').join(', ')}`);

    if (APPLY) {
      await db.doc(`bandProfiles/${docSnap.id}/private/details`).set(privateDetails, { merge: true });
      await db.doc(`bandProfiles/${docSnap.id}`).update(publicUpdates);
      console.log('    written');
    }
    moved++;
  }

  console.log(`\nArtists: ${moved} to migrate, ${skipped} skipped (no private data)\n`);
}

async function main() {
  await migrateVenues();
  await migrateArtists();
  console.log(APPLY ? 'Migration complete.' : 'Dry run complete. Re-run with --apply to write changes.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
