/**
 * Patches all hidden bandProfiles and venues so they appear in listings.
 * Only fills in the minimum required fields — does not overwrite existing data.
 *
 * Usage: node scripts/patchHidden.js
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

function slugify(name) {
  return name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
}

function inferVenueType(name) {
  const n = name.toLowerCase();
  if (n.includes('hotel') || n.includes('pub') || n.includes('tavern')) return 'Pub / Hotel';
  if (n.includes('jazz') || n.includes('music hall') || n.includes('music venue')) return 'Music Venue';
  if (n.includes('cafe') || n.includes('cafe')) return 'Cafe / Restaurant';
  if (n.includes('club') || n.includes('speakeasy')) return 'Club';
  if (n.includes('rooftop') || n.includes('convent') || n.includes('sea bath') || n.includes('beach')) return 'Function / Event Space';
  return 'Bar';
}

async function main() {
  let bandPatched = 0, venuePatched = 0;

  // ── Band profiles ─────────────────────────────────────────────────────────
  const bandSnap = await db.collection('bandProfiles').get();
  const bandBatch = db.batch();

  for (const doc of bandSnap.docs) {
    const m = doc.data();
    const missing = [];
    if (!m.name?.trim())        missing.push('name');
    if (!m.username?.trim())    missing.push('username');
    if (!m.email?.trim())       missing.push('email');
    if (!m.artistType?.trim())  missing.push('artistType');
    if (!(m.genre?.length > 0)) missing.push('genre');
    if (!(m.instruments?.length > 0)) missing.push('instruments');
    if (m.settings?.listed === false) missing.push('listed');

    if (missing.length === 0) continue;

    const patch = {};

    // Only Valenta is known — add instruments. Don't guess for 22mackie.
    if (doc.id === 'brMEGLaskmSmp3bAleCTCAYsWT43') {
      // Valenta — add instruments to pass filter
      if (!m.instruments?.length) patch.instruments = ['Vocals', 'Guitar', 'Bass', 'Drums'];
      console.log(' Patching band:', m.name, '→ instruments');
    } else if (missing.includes('genre') || missing.includes('instruments')) {
      // Other profiles with missing required fields — skip unless explicitly requested
      console.log(' Skipping band (incomplete):', m.name, '— missing', missing.join(', '));
      continue;
    }

    if (Object.keys(patch).length > 0) {
      bandBatch.update(doc.ref, patch);
      bandPatched++;
    }
  }

  await bandBatch.commit();

  // ── Venues ────────────────────────────────────────────────────────────────
  const venueSnap = await db.collection('venues').get();

  // Firestore batch limit is 500 ops — chunk if needed
  const CHUNK = 400;
  let ops = [];

  for (const doc of venueSnap.docs) {
    const v = doc.data();
    const missing = [];
    if (!v.name?.trim())          missing.push('name');
    if (!v.username?.trim())      missing.push('username');
    if (!v.venueType?.trim())     missing.push('venueType');
    if (!v.streetAddress?.trim()) missing.push('streetAddress');
    if (!v.hasBookingContact && !v.email?.trim()) missing.push('email');

    if (missing.length === 0) continue;

    const patch = {};
    if (!v.username?.trim())     patch.username = slugify(v.name || doc.id);
    if (!v.venueType?.trim())    patch.venueType = inferVenueType(v.name || '');
    if (!v.hasBookingContact && !v.email?.trim()) patch.hasBookingContact = true;

    ops.push({ ref: doc.ref, patch });
    console.log(' Patching venue:', v.name);
  }

  // Commit in chunks of 400
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const { ref, patch } of chunk) batch.update(ref, patch);
    await batch.commit();
    venuePatched += chunk.length;
  }

  console.log(`\nDone. Patched ${bandPatched} band profile(s), ${venuePatched} venue(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
