/**
 * Import Melbourne live music venues from the Live Music Locator (lml.live) API
 * into GigMatch's Firestore `venues` collection.
 *
 * Creates skeleton venue records (name, address, lat/lng, website).
 * All venues are set to listed: false — publish manually after review.
 *
 * Usage:
 *   1. Download your Firebase service account key:
 *      Firebase Console > Project settings > Service accounts > Generate new private key
 *      Save as: scripts/serviceAccountKey.json
 *   2. Install deps (one-off):
 *      npm install firebase-admin
 *   3. Run:
 *      node scripts/importLMLVenues.js
 *
 * Requires: Node.js 18+
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// ── Firebase setup ────────────────────────────────────────────────────────────

const keyPath = resolve(__dirname, 'scripts1serviceAccountKey.json');
let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch {
  console.error(
    '\nERROR: Service account key not found.\n' +
    'Download it from Firebase Console > Project settings > Service accounts\n' +
    'and save it as: scripts1/serviceAccountKey.json\n',
  );
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ── Venue data (sourced from api.lml.live, Melbourne, Sep–Dec 2025) ───────────
// Manually cleaned: streetAddress is street only, suburb extracted separately.

const VENUES = [
  { name: 'Tote Hotel',                               streetAddress: '71 Johnston Street',         suburb: 'Collingwood',    postcode: '3066', latitude: -37.79940781,  longitude: 144.9870191,  website: 'http://thetotehotel.com/' },
  { name: 'Pause Bar',                                streetAddress: '268 Carlisle St',             suburb: 'Balaclava',      postcode: '3183', latitude: -37.8685704,   longitude: 144.9929526,  website: 'https://pausebar.com.au/' },
  { name: 'Iddy Biddy Bar',                           streetAddress: '35/39 Blessington St',        suburb: 'St Kilda',       postcode: '3182', latitude: -37.8704358,   longitude: 144.9809006,  website: 'https://www.iddybiddy.com.au/whats-on.html' },
  { name: 'Lona',                                     streetAddress: '64/66 Acland St',             suburb: 'St Kilda',       postcode: '3182', latitude: -37.8667229,   longitude: 144.978209,   website: 'http://lona.com.au/' },
  { name: 'Uptown Jazz Cafe',                         streetAddress: '177 Brunswick St',            suburb: 'Fitzroy',        postcode: '3065', latitude: -37.80213846,  longitude: 144.9775826,  website: 'http://www.uptownjazzcafe.com/' },
  { name: "Johnny's",                                 streetAddress: '47 Blessington St',           suburb: 'St Kilda',       postcode: '3182', latitude: -37.870394,    longitude: 144.981155,   website: 'https://www.facebook.com/p/Johnnys-100063470446670/' },
  { name: 'Bar Open',                                 streetAddress: '317 Brunswick St',            suburb: 'Fitzroy',        postcode: '3065', latitude: -37.797592,    longitude: 144.978388,   website: 'https://baropen.com.au' },
  { name: 'The Rooks Return',                         streetAddress: '201 Brunswick Street',        suburb: 'Fitzroy',        postcode: '3065', latitude: -37.80122766,  longitude: 144.9777889,  website: 'http://therooksreturn.com.au/' },
  { name: "Baxter's Lot",                             streetAddress: '1/296 Brunswick St',          suburb: 'Fitzroy',        postcode: '3065', latitude: -37.7984208,   longitude: 144.9786498,  website: 'https://www.facebook.com/baxterslot/' },
  { name: 'The Old Bar',                              streetAddress: '74-76 Johnston Street',       suburb: 'Fitzroy',        postcode: '3065', latitude: -37.798362,    longitude: 144.977083,   website: 'http://www.theoldbar.com.au/' },
  { name: 'Bodriggy Brew Pub',                        streetAddress: '243-245 Johnston Street',     suburb: 'Abbotsford',     postcode: '3067', latitude: -37.80015875,  longitude: 144.99446,    website: 'https://bodriggy.beer/' },
  { name: 'Abbotsford Convent Community and Linen Rooms', streetAddress: '1 St Heliers St',         suburb: 'Abbotsford',     postcode: '3067', latitude: -37.8022293,   longitude: 145.0038689,  website: 'https://abbotsfordconvent.com.au/event/' },
  { name: 'Memo Music Hall',                          streetAddress: '88 Acland Street',            suburb: 'St Kilda',       postcode: '3182', latitude: -37.8673248,   longitude: 144.9791412,  website: 'https://www.memomusichall.com.au/' },
  { name: 'Rising Sun Hotel',                         streetAddress: '2 Raglan St',                 suburb: 'South Melbourne', postcode: '3205', latitude: -37.8361182,  longitude: 144.9666654,  website: 'http://www.risingsunhotel.au/' },
  { name: 'Hotel Esplanade - Gershwin Room',          streetAddress: '11 The Esplanade',            suburb: 'St Kilda',       postcode: '3182', latitude: -37.8642181,   longitude: 144.9728535,  website: 'https://hotelesplanade.com.au/' },
  { name: 'Hotel Esplanade - The Basement',           streetAddress: '11 The Esplanade',            suburb: 'St Kilda',       postcode: '3182', latitude: -37.8642181,   longitude: 144.9728535,  website: 'http://hotelesplanade.com.au/' },
  { name: 'The Workers Club',                         streetAddress: '51 Brunswick Street',         suburb: 'Fitzroy',        postcode: '3065', latitude: -37.805598,    longitude: 144.977022,   website: 'http://www.theworkersclub.com.au/' },
  { name: 'The Dogs Bar',                             streetAddress: '54 Acland Street',            suburb: 'St Kilda',       postcode: '3182', latitude: -37.866341,    longitude: 144.9778875,  website: 'https://www.instagram.com/dogsbar.stkilda/' },
  { name: 'Nighthawks Bar',                           streetAddress: '136 Johnston Street',         suburb: 'Collingwood',    postcode: '3066', latitude: -37.79936417,  longitude: 144.9895533,  website: 'https://nighthawksbar.com.au/' },
  { name: 'The Night Cat',                            streetAddress: '137-141 Johnston St',         suburb: 'Fitzroy',        postcode: '3065', latitude: -37.7982121,   longitude: 144.9768665,  website: 'http://www.thenightcat.com.au' },
  { name: 'Fifth Province',                           streetAddress: '60 Fitzroy Street',           suburb: 'St Kilda',       postcode: '3182', latitude: -37.8594274,   longitude: 144.9775347,  website: 'https://www.thefifthprovince.com.au/gigguide' },
  { name: 'Railway Hotel',                            streetAddress: '800 Nicholson Street',        suburb: 'Fitzroy North',  postcode: '3068', latitude: -37.780647,    longitude: 144.97827,    website: 'http://www.railwayhotelfitzroy.com.au/' },
  { name: 'The Horn African Cafe',                    streetAddress: '20 Johnston Street',          suburb: 'Collingwood',    postcode: '3066', latitude: -37.798948,    longitude: 144.985472,   website: 'http://thehorncafe.com.au/' },
  { name: 'The Evelyn Hotel',                         streetAddress: '351 Brunswick Street',        suburb: 'Fitzroy',        postcode: '3065', latitude: -37.79655875,  longitude: 144.9785525,  website: 'http://evelynhotel.com.au/' },
  { name: 'Red Eye Bar',                              streetAddress: '17 Carlisle St',              suburb: 'St Kilda',       postcode: '3182', latitude: -37.8671777,   longitude: 144.9772819,  website: 'https://linktr.ee/Redeyebar' },
  { name: '29th Apartment',                           streetAddress: '29 Fitzroy Street',           suburb: 'St Kilda',       postcode: '3182', latitude: -37.8622125,   longitude: 144.9740264,  website: 'https://29thapartment.com.au/' },
  { name: 'The Punters Club',                         streetAddress: '376 Brunswick Street',        suburb: 'Fitzroy',        postcode: '3065', latitude: -37.7961287,   longitude: 144.979114,   website: 'https://www.puntersclubfitzroy.com/' },
  { name: 'The Fox Hotel 1887',                       streetAddress: '351 Wellington Street',       suburb: 'Collingwood',    postcode: '3066', latitude: -37.794511,    longitude: 144.987943,   website: 'http://thefoxhotel.com.au/' },
  { name: 'Tramway Hotel',                            streetAddress: '165 Rae Street',              suburb: 'Fitzroy North',  postcode: '3068', latitude: -37.788527,    longitude: 144.978975,   website: 'http://www.tramwayhotel.com.au/' },
  { name: 'George Lane',                              streetAddress: '1 George Lane',               suburb: 'St Kilda',       postcode: '3182', latitude: -37.8598453,   longitude: 144.9781527,  website: 'https://www.georgelane.com.au/events-1' },
  { name: 'Lulie Tavern',                             streetAddress: '225 Johnston Street',         suburb: 'Abbotsford',     postcode: '3067', latitude: -37.8000784,   longitude: 144.993596,   website: 'https://www.lulietavern.com/lulieevents' },
  { name: 'Corner Hotel',                             streetAddress: '57 Swan Street',              suburb: 'Richmond',       postcode: '3121', latitude: -37.82459819,  longitude: 144.9925378,  website: 'http://www.cornerhotel.com/' },
  { name: 'Freddie Wimpoles',                         streetAddress: '125 Fitzroy St',              suburb: 'St Kilda',       postcode: '3182', latitude: -37.859804,    longitude: 144.9778135,  website: 'https://www.freddiewimpoles.com/gig-guide' },
  { name: 'The Prince Hotel',                         streetAddress: '2 Acland St',                 suburb: 'St Kilda',       postcode: '3182', latitude: -37.8623364,   longitude: 144.9741117,  website: 'https://theprince.com.au/prince-bandroom/gig-guide/' },
  { name: 'The Palace Hotel',                         streetAddress: '505-507 City Rd',             suburb: 'South Melbourne', postcode: '3205', latitude: -37.8339964,  longitude: 144.9500626,  website: 'https://www.thepalacehotel.com.au/' },
  { name: 'The Richmond Club Hotel',                  streetAddress: '100 Swan Street',             suburb: 'Richmond',       postcode: '3121', latitude: -37.8254126,   longitude: 144.9932511,  website: 'https://richmondclubhotel.com.au/whats-on/' },
  { name: 'Ellora',                                   streetAddress: '1 Fitzroy St',                suburb: 'St Kilda',       postcode: '3182', latitude: -37.862743,    longitude: 144.972902,   website: 'https://www.ellora.com.au/live-music' },
  { name: 'New Guernica',                             streetAddress: '64 Smith St',                 suburb: 'Collingwood',    postcode: '3066', latitude: -37.8062237,   longitude: 144.9806166,  website: 'https://www.newguernica.com/events' },
  { name: 'Dr Morse',                                 streetAddress: '274 Johnston St',             suburb: 'Abbotsford',     postcode: '3067', latitude: -37.7998365,   longitude: 144.9941413,  website: 'https://drmorse.com.au/' },
  { name: 'Runner Up Bar',                            streetAddress: '35 Johnston St',              suburb: 'Collingwood',    postcode: '3066', latitude: -37.7992906,   longitude: 144.9835508,  website: 'https://runnerup.net.au' },
  { name: 'The Fitzroy Pinnacle',                     streetAddress: '251-255 St Georges Road',     suburb: 'Fitzroy North',  postcode: '3068', latitude: -37.782855,    longitude: 144.9840015,  website: 'http://www.fitzroypinnacle.com.au/' },
  { name: 'Bad Decisions Bar',                        streetAddress: '46 Johnston Street',          suburb: 'Fitzroy',        postcode: '3065', latitude: -37.7982682,   longitude: 144.9762913,  website: 'http://www.thebdb.com.au/' },
  { name: 'Claypots Seafood Bar',                     streetAddress: '213 Barkly St',               suburb: 'St Kilda',       postcode: '3182', latitude: -37.8699281,   longitude: 144.9804956,  website: 'https://www.instagram.com/claypots.st.kilda/' },
  { name: 'Loud Mouth',                               streetAddress: '168 Acland St',               suburb: 'St Kilda',       postcode: '3182', latitude: -37.8693181,   longitude: 144.9806509,  website: 'https://www.loudmouthbar.com/' },
  { name: 'Creatures of Habit Bar and Bandroom',      streetAddress: '319 Brunswick Street',        suburb: 'Fitzroy',        postcode: '3065', latitude: -37.79759671,  longitude: 144.9784599,  website: 'http://www.creaturesofhabit.com.au/' },
  { name: "Jimmy O'Neill's",                          streetAddress: '154-156 Acland St',           suburb: 'St Kilda',       postcode: '3182', latitude: -37.8689673,   longitude: 144.9803686,  website: 'https://www.instagram.com/jimmy.oneills/' },
  { name: 'The Albion Rooftop',                       streetAddress: '172 York Street',             suburb: 'South Melbourne', postcode: '3205', latitude: -37.831577,   longitude: 144.9560202,  website: 'https://albionrooftop.com.au/' },
  { name: "Yah Yah's",                               streetAddress: '99 Smith Street',             suburb: 'Fitzroy',        postcode: '3065', latitude: -37.80587945,  longitude: 144.9828984,  website: 'http://www.yahyahs.com.au/' },
  { name: 'The Exchange Hotel',                       streetAddress: '39 Bay St',                   suburb: 'Port Melbourne', postcode: '3207', latitude: -37.8419782,   longitude: 144.9388301,  website: 'https://www.theexchangehotel.net.au/' },
  { name: 'Cornerstone',                              streetAddress: '1 Crockford St',              suburb: 'Port Melbourne', postcode: '3207', latitude: -37.8346131,   longitude: 144.9464387,  website: 'https://www.thecornerstonepub.com.au/' },
  { name: 'Republica',                                streetAddress: '10-18 Jacka Blvd',            suburb: 'St Kilda',       postcode: '3182', latitude: -37.8656826,   longitude: 144.9723634,  website: 'https://republica.net.au/whats-on/' },
  { name: 'The Leadbeater Hotel',                     streetAddress: '1 Church Street',             suburb: 'Richmond',       postcode: '3121', latitude: -37.8108287,   longitude: 145.0008084,  website: 'http://www.leadbeaterhotel.com.au/' },
  { name: 'Lucien',                                   streetAddress: '1/157 Fitzroy St',            suburb: 'St Kilda',       postcode: '3182', latitude: -37.8588534,   longitude: 144.9793198,  website: 'http://lucienbar.au/' },
  { name: 'Captain Baxter',                           streetAddress: '10/10-18 Jacka Blvd',         suburb: 'St Kilda',       postcode: '3182', latitude: -37.8657289,   longitude: 144.9721628,  website: 'https://www.captainbaxter.com.au/whats-on/' },
  { name: 'St Kilda Sea Baths',                       streetAddress: '10-18 Jacka Blvd',            suburb: 'St Kilda',       postcode: '3182', latitude: -37.8652736,   longitude: 144.9717383,  website: 'http://www.seabaths.com.au/' },
  { name: 'Voodoo Love Child Speakeasy Bar',          streetAddress: '143 Chapel St',               suburb: 'St Kilda',       postcode: '3182', latitude: -37.8677105,   longitude: 144.9903264,  website: 'https://www.instagram.com/voodoolovechildspeakeasy/' },
  { name: 'The Local Taphouse',                       streetAddress: '184 Carlisle St',             suburb: 'St Kilda East',  postcode: '3183', latitude: -37.8681208,   longitude: 144.989994,   website: 'https://www.instagram.com/thelocaltaphousesk/' },
  { name: 'Abbots Yard',                              streetAddress: '329-341 Victoria St',         suburb: 'Abbotsford',     postcode: '3067', latitude: -37.80996706,  longitude: 144.9963951,  website: 'https://www.abbotsyard.com/' },
  { name: 'Riviera Beach Club',                       streetAddress: '42B Marine Parade',           suburb: 'Elwood',         postcode: '3184', latitude: -37.8755404,   longitude: 144.9751407,  website: 'https://www.rivierabeachclub.com.au/' },
  { name: 'Glamorama Bar',                            streetAddress: '393-395 Brunswick Street',    suburb: 'Fitzroy',        postcode: '3065', latitude: -37.795435,    longitude: 144.97873,    website: 'http://www.glamoramabar.com/' },
  { name: 'Grace Darling Hotel',                      streetAddress: '114 Smith Street',            suburb: 'Collingwood',    postcode: '3066', latitude: -37.80483451,  longitude: 144.9834494,  website: 'http://thegracedarlinghotel.com.au/' },
  { name: 'Gem Bar',                                  streetAddress: '289 Wellington St',           suburb: 'Collingwood',    postcode: '3066', latitude: -37.7964252,   longitude: 144.9851255,  website: 'http://www.thegembar.com.au/' },
  { name: 'Bendigo Hotel',                            streetAddress: '125 Johnston Street',         suburb: 'Collingwood',    postcode: '3066', latitude: -37.79962095,  longitude: 144.9891044,  website: 'http://www.bendigohotel.com.au/' },
  { name: 'The Standard Hotel',                       streetAddress: '419 Fitzroy St',              suburb: 'Fitzroy',        postcode: '3065', latitude: -37.8007371,   longitude: 144.9768234,  website: 'https://www.thestandardhotel.com.au/' },
  { name: 'The Vineyard',                             streetAddress: '71A Acland St',               suburb: 'St Kilda',       postcode: '3182', latitude: -37.8675253,   longitude: 144.9759212,  website: 'https://thevineyard.com.au/vineyard-bar/' },
  { name: 'Avalon the Bar',                           streetAddress: '387 Brunswick St',            suburb: 'Fitzroy',        postcode: '3065', latitude: -37.795606,    longitude: 144.978714,   website: 'https://instagram.com/avalonthebar' },
  { name: 'Radio Bar and Cafe',                       streetAddress: '357 Brunswick Street',        suburb: 'Fitzroy',        postcode: '3065', latitude: -37.796438,    longitude: 144.978574,   website: 'https://www.instagram.com/radio_bar/' },
  { name: 'The Catfish',                              streetAddress: '30 Gertrude St',              suburb: 'Fitzroy',        postcode: '3065', latitude: -37.8056888,   longitude: 144.9751858,  website: 'http://www.thecatfish.com.au/' },
  { name: 'The Local',                                streetAddress: '22-24 Bay St',                suburb: 'Port Melbourne', postcode: '3207', latitude: -37.842748,    longitude: 144.938832,   website: 'https://www.thelocalportmelbourne.com.au/' },
  { name: 'Fitzroy Rainbow Hotel',                    streetAddress: '27 Saint David Street',       suburb: 'Fitzroy',        postcode: '3065', latitude: -37.8006248,   longitude: 144.979469,   website: 'http://www.therainbow.com.au/' },
  { name: 'The Open Space',                           streetAddress: '11 Acacia Pl',                suburb: 'Abbotsford',     postcode: '3067', latitude: -37.8111401,   longitude: 145.0140482,  website: 'https://www.facebook.com/p/The-Open-Space-100075786043186/' },
  { name: 'Odeon Richmond',                           streetAddress: '267 Swan St',                 suburb: 'Richmond',       postcode: '3121', latitude: -37.8258285,   longitude: 145.0015258,  website: 'https://www.odeonrichmond.com.au/experiences' },
  { name: 'St Luja',                                  streetAddress: '9 Fitzroy St',                suburb: 'St Kilda',       postcode: '3182', latitude: -37.8625604,   longitude: 144.9731143,  website: 'https://stluja.com.au/' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildLocation(suburb, state, postcode) {
  return [suburb, state, postcode].filter(Boolean).join(', ');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('─'.repeat(62));
  console.log('  GigMatch — Import LML Melbourne Venues');
  console.log('─'.repeat(62));

  // 1. Fetch existing venue names for duplicate check
  console.log('\n[1/3] Fetching existing venues...');
  const snapshot = await db.collection('venues').get();
  const existingNames = new Set(
    snapshot.docs.map(d => (d.data().name ?? '').toLowerCase().trim()),
  );
  console.log(`      ${snapshot.size} existing venue(s) found.`);

  // 2. Determine what to add
  console.log('\n[2/3] Checking for duplicates...');
  const toAdd = [];
  for (const v of VENUES) {
    const key = v.name.toLowerCase().trim();
    if (existingNames.has(key)) {
      console.log(`  SKIP  "${v.name}"`);
    } else {
      console.log(`  ADD   "${v.name}"`);
      toAdd.push(v);
    }
  }

  if (toAdd.length === 0) {
    console.log('\nNothing to add — all venues already exist.');
    process.exit(0);
  }

  // 3. Insert
  console.log(`\n[3/3] Adding ${toAdd.length} venue(s)...`);
  let added = 0;
  let failed = 0;

  for (const v of toAdd) {
    const state = 'VIC';
    const location = buildLocation(v.suburb, state, v.postcode);

    const doc = {
      name: v.name,
      streetAddress: v.streetAddress,
      location,
      suburb: v.suburb,
      state,
      postcode: String(v.postcode),
      phone: '',
      email: '',
      website: v.website || '',
      description: '',
      photoUrl: '',
      latitude: String(v.latitude),
      longitude: String(v.longitude),
      rooms: [],
      gigNights: [],
      techSpecs: {},
      settings: {
        emailOnNewEnquiry: false,
        emailEnquiryReminders: false,
        listed: true,
      },
      photos: [],
      videos: [],
      payment: {},
      photoPosition: { x: 50, y: 50 },
      onboardingComplete: true,
      importSource: 'lml',
      createdAt: FieldValue.serverTimestamp(),
    };

    try {
      const ref = await db.collection('venues').add(doc);
      console.log(`  +  "${v.name}" → ${ref.id}`);
      added++;
    } catch (err) {
      console.error(`  ERROR adding "${v.name}":`, err.message);
      failed++;
    }
  }

  console.log('\n' + '─'.repeat(62));
  console.log(`  Done. Added: ${added}  |  Skipped (existing): ${VENUES.length - toAdd.length}  |  Failed: ${failed}`);
  console.log('─'.repeat(62) + '\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err);
  process.exit(1);
});
