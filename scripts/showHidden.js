/**
 * Diagnoses and patches hidden bandProfiles + venues so they appear in listings.
 *
 * BandProfile listing requires: name, username, email, artistType, genre[], instruments[]
 * Venue listing requires: name, username, venueType, streetAddress, email/hasBookingContact
 *
 * Usage: node scripts/showHidden.js
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

async function main() {
  // ── Band profiles ─────────────────────────────────────────────────────────
  const bandSnap = await db.collection('bandProfiles').get();
  console.log('\n=== BAND PROFILES ===');

  for (const doc of bandSnap.docs) {
    const m = doc.data();
    const missing = [];
    if (!m.name?.trim())        missing.push('name');
    if (!m.username?.trim())    missing.push('username');
    if (!m.email?.trim())       missing.push('email');
    if (!m.artistType?.trim())  missing.push('artistType');
    if (!(m.genre?.length > 0)) missing.push('genre');
    if (!(m.instruments?.length > 0)) missing.push('instruments');

    const listed = m.settings?.listed !== false;
    const visible = missing.length === 0 && listed;

    if (!visible) {
      console.log(`\nHIDDEN: ${m.name || '(no name)'} [${doc.id}]`);
      if (missing.length) console.log('  Missing:', missing.join(', '));
      if (!listed) console.log('  settings.listed = false');
    } else {
      console.log(`  OK: ${m.name} @${m.username}`);
    }
  }

  // ── Venues ────────────────────────────────────────────────────────────────
  const venueSnap = await db.collection('venues').get();
  console.log('\n=== VENUES ===');

  for (const doc of venueSnap.docs) {
    const v = doc.data();
    const missing = [];
    if (!v.name?.trim())          missing.push('name');
    if (!v.username?.trim())      missing.push('username');
    if (!v.venueType?.trim())     missing.push('venueType');
    if (!v.streetAddress?.trim()) missing.push('streetAddress');
    if (!v.hasBookingContact && !v.email?.trim()) missing.push('email/hasBookingContact');

    if (missing.length > 0) {
      console.log(`\nHIDDEN: ${v.name || '(no name)'} [${doc.id}]`);
      console.log('  Missing:', missing.join(', '));
      console.log('  Current:', {
        name: v.name, username: v.username, venueType: v.venueType,
        streetAddress: v.streetAddress, email: v.email,
        hasBookingContact: v.hasBookingContact,
      });
    } else {
      console.log(`  OK: ${v.name} @${v.username}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
