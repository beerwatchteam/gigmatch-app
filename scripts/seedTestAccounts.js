/**
 * Seed script — creates fully-populated test accounts:
 *   • Twaylo Artist  (artist / 4-piece band, Melbourne)
 *   • Twaylo Venue   (venue, Melbourne)
 *
 * Both usernames and passwords match the display name (lowercase, no spaces).
 *
 * Usage:
 *   node scripts/seedTestAccounts.js
 *
 * Requires: Node.js 18+, firebase-admin installed (already present in /scripts/node_modules)
 * Service account key: scripts/scripts1serviceAccountKey.json
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue }     = require('firebase-admin/firestore');
const { getAuth }                      = require('firebase-admin/auth');

// ── Firebase setup ────────────────────────────────────────────────────────────

// IMPORTANT: use scripts:scripts1serviceAccountKey.json (gigmatchweb-aus — the live project)
// NEVER use scripts1serviceAccountKey.json — that belongs to gigmatch-6343a (wrong/dead project)
const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch {
  console.error('Service account key not found at', keyPath);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db   = getFirestore();
const auth = getAuth();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrCreateUser(email, password, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    console.log('  Auth user already exists:', email, '(uid:', existing.uid + ')');
    return existing.uid;
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      const user = await auth.createUser({ email, password, displayName, emailVerified: true });
      console.log('  Created auth user:', email, '(uid:', user.uid + ')');
      return user.uid;
    }
    throw e;
  }
}

// ── Artist seed data ──────────────────────────────────────────────────────────

async function seedArtist() {
  console.log('\n--- Seeding Twaylo Artist ---');

  const email    = 'twayloartist@example.com';
  const password = 'twayloartist';
  const username = 'twayloartist';

  const uid = await getOrCreateUser(email, password, 'Faultline');

  await db.doc('users/' + uid).set({
    type:        'artist',
    displayName: 'Faultline',
    username,
    email,
    createdAt:   FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.doc('bandProfiles/' + uid).set({
    name:            'Faultline',
    username,
    artistType:      'Band',
    otherArtistType: '',
    genre:           ['Rock', 'Indie', 'Blues'],
    otherGenres:     '',
    instruments:     ['Guitar', 'Bass', 'Drums', 'Vocals'],
    location:        'Melbourne, VIC',
    email,
    phone:           '+61 412 345 678',
    feeMin:          600,
    feeMax:          1800,
    averageDraw:     80,
    travel:          'Melbourne metro and regional VIC. Interstate by negotiation.',
    memberCount:     '4',
    members: [
      { name: 'Rex Halloway', role: 'Vocals' },
      { name: 'Mara Vex',     role: 'Guitar' },
      { name: 'Dax Fenn',     role: 'Bass' },
      { name: 'Suki Crane',   role: 'Drums' },
    ],
    formed:           '2020',
    setType:          'Mixed',
    ageRestriction:   'All ages',
    setLengths:       ['45 min', '60 min', '2 x 45 min'],
    feeOpenToOffers:  true,
    drawEstimateBand: '60-100',
    about: "Four-piece rock outfit from Melbourne's inner north. Equal parts grit and melody, with a live show built for pubs and mid-sized stages. Drawing on rock, indie, and blues influences, Faultline delivers tight, high-energy sets that keep crowds engaged from first song to last.\n\nActive since 2020, the band has performed at venues across Melbourne including the Corner Hotel, The Espy, and Northcote Social Club. Available for headline slots, support acts, and residencies.",
    instagram:  'twayloartist',
    tiktok:     '',
    spotify:    '',
    appleMusic: '',
    youtube:    '',
    website:    '',
    customLinks: [],
    songs:       [],
    artistPages: [
      { platform: 'Instagram', url: 'https://instagram.com/twayloartist' },
    ],
    photos:       [],
    videos:       [],
    videoObjects: [],
    gigHistory: [
      { venue: 'Corner Hotel',          suburb: 'Richmond',     date: '2024-03-15', attendance: '180', notes: 'Support for touring act.' },
      { venue: 'The Espy',              suburb: 'St Kilda',     date: '2024-06-22', attendance: '220', notes: 'Headline set, sold out.' },
      { venue: 'Workers Club',          suburb: 'Fitzroy',      date: '2024-09-07', attendance: '95',  notes: 'Saturday night residency show.' },
      { venue: 'Northcote Social Club', suburb: 'Northcote',    date: '2024-11-30', attendance: '140', notes: '' },
      { venue: 'The Gasometer',         suburb: 'Collingwood',  date: '2025-02-08', attendance: '110', notes: 'Album launch show.' },
      { venue: 'Old Bar',               suburb: 'Fitzroy North', date: '2025-04-19', attendance: '75', notes: '' },
    ],
    techRider: {
      stageSize:       'Minimum 4m wide x 3m deep',
      monitoringNotes: 'Two monitor mixes minimum. Drummer and vocalist on separate sends.',
      soundcheckNotes: 'Require 45 minutes for soundcheck.',
      additionalNotes: 'Drummer brings full kit including snare, kick, hi-hat, rack tom, floor tom. No cymbals required.',
    },
    techRiderBools: {
      requiresPA:        true,
      requiresMonitors:  true,
      providesDrumKit:   true,
      requiresBassAmp:   false,
      requiresGuitarAmp: false,
    },
    techRiderDocs:    [],
    inputChannels: [
      { source: 'Kick',          micDi: 'MIC' },
      { source: 'Snare top',     micDi: 'MIC' },
      { source: 'Snare bottom',  micDi: 'MIC' },
      { source: 'Hi-hat',        micDi: 'MIC' },
      { source: 'Overhead L',    micDi: 'MIC' },
      { source: 'Overhead R',    micDi: 'MIC' },
      { source: 'Bass',          micDi: 'DI'  },
      { source: 'Guitar',        micDi: 'MIC' },
      { source: 'Lead vox',      micDi: 'MIC' },
      { source: 'BV 1',          micDi: 'MIC' },
    ],
    backlineFromVenue: [],
    backlineBring:     ['Guitar amp', 'Bass amp'],
    hospitality: {
      mealsRequired:  false,
      mealCount:      '',
      dietaryReqs:    '',
      drinks:         '4 x bottled water on stage.',
      greenRoom:      true,
      merchTable:     true,
      parkingLoading: 'Loading access appreciated. Band van.',
      accommodation:  false,
    },
    payment: {
      methods:                 ['Bank transfer', 'Cash'],
      abn:                     '',
      abnStatus:               'no_abn_hobby',
      gstRegistered:           false,
      canProvideInvoice:       false,
      invoicingName:           'Faultline',
      timing:                  'Within 7 days',
      timingOther:             '',
      paymentNotes:            'Bank transfer preferred. BSB and account number provided on booking.',
      publicLiabilityHeld:     false,
      publicLiabilityCoverage: '',
      insuranceCertAvailable:  false,
    },
    settings: {
      emailOnEnquiryResponse: true,
      emailOnNewMessages:     true,
      emailOnNewConnection:   false,
      listed:                 true,
    },
    onboardingComplete: true,
    participantIds:     [uid],
    createdAt:          FieldValue.serverTimestamp(),
    updatedAt:          FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.doc('bandProfiles/' + uid + '/private/details').set({
    email,
    phone: '+61 412 345 678',
    hospitality: {
      mealsRequired:  false,
      drinks:         '4 x bottled water on stage.',
      greenRoom:      true,
      merchTable:     true,
      parkingLoading: 'Loading access appreciated.',
      accommodation:  false,
    },
    payment: {
      methods:                ['Bank transfer', 'Cash'],
      abn:                    '',
      abnStatus:              'no_abn_hobby',
      invoicingName:          'Faultline',
      timing:                 'Within 7 days',
      timingOther:            '',
      paymentNotes:           'Bank transfer preferred.',
      insuranceCertAvailable: false,
    },
  });

  console.log('  Artist profile written.');
}

// ── Venue seed data ───────────────────────────────────────────────────────────

async function seedVenue() {
  console.log('\n--- Seeding Twaylo Venue ---');

  const email    = 'twaylovenue@example.com';
  const password = 'twaylovenue';
  const username = 'twaylovenue';
  const venueId  = 'twaylovenue';

  const uid = await getOrCreateUser(email, password, 'The Coalface');

  await db.doc('venues/' + venueId).set({
    name:          'The Coalface',
    username,
    streetAddress: '234 Smith Street',
    location:      '234 Smith Street, Collingwood VIC 3066',
    suburb:        'Collingwood',
    state:         'VIC',
    postcode:      '3066',
    phone:         '+61 3 9417 2345',
    email,
    website:       'https://twaylo.com.au',
    instagram:     'twaylovenue',
    facebook:      'twaylovenue',
    description:   "The Coalface is a classic Melbourne pub with a dedicated live music room on the corner of Smith Street, Collingwood. Capacity 280 across the main bar and stage area. We run live music every Friday and Saturday night year-round, with occasional Thursday and Sunday shows.\n\nThe stage is 6m wide x 4m deep with a full PA system and house engineer available. We book rock, indie, blues, soul, and funk acts. Both originals and covers welcome. Application-only bookings — we respond to all enquiries within 48 hours.",
    venueType:        'Pub',
    venueTypes:       ['Pub', 'Live music venue'],
    genrePreferences: ['Rock', 'Indie', 'Blues', 'Soul / R&B', 'Funk'],
    setsYouBook:      ['Originals', 'Covers', 'Mixed'],
    ageRestriction:   '18+ only',
    latitude:         '-37.8047',
    longitude:        '144.9957',
    photoUrl:         '',
    logoUrl:          '',
    showPhone:        false,
    bookingContactName:   'Cal Mercer',
    bookingContactPhone:  '+61 412 987 654',
    invoicingMode:        'actsInvoice',
    invoicingNotes:       'Invoices to accounts@example.com. ABN on request.',
    accountsContactName:  'Petra Vane',
    accountsContactEmail: 'accounts@example.com',
    legalEntityName:      'The Coalface Pty Ltd',
    claimedBy:      uid,
    claimedByEmail: email,
    claimedAt:      FieldValue.serverTimestamp(),
    rooms: [
      {
        name:            'The Back Room',
        capacity:        '200',
        stage:           '6m wide x 4m deep timber stage',
        monitoring:      'Wedges',
        backline:        'Full PA, drum riser',
        stageWidth:      '6',
        stageDepth:      '4',
        monitoringType:  'Wedges',
        monitoringMixes: '3',
        backlineItems:   ['PA system', 'Stage monitors', 'Microphones + stands', 'Drum kit', 'Lighting rig'],
        pa:              'L-Acoustics 108P tops, 118S subs x2, Yamaha QL1 console',
        lighting:        'Basic stage wash, PAR cans. No moving heads.',
        power:           '15A outlets on stage x4, GPO for backline.',
        notes:           'House engineer available at no extra cost. BYO IEMs if preferred.',
        documents:       [],
      },
      {
        name:            'Main Bar',
        capacity:        '80',
        stage:           'Corner stage, 3m x 2m',
        monitoring:      'Wedges',
        backline:        'Small PA',
        stageWidth:      '3',
        stageDepth:      '2',
        monitoringType:  'Wedges',
        monitoringMixes: '1',
        backlineItems:   ['PA system', 'Microphones + stands'],
        pa:              'QSC K12.2 x2, QSC KSub x1, Behringer X32 Compact',
        lighting:        'Dimmable bar lighting only.',
        power:           '15A outlet x2.',
        notes:           'Acoustic, duo, and small trio formats only. No full drum kits in main bar.',
        documents:       [],
      },
    ],
    gigNights: [
      {
        name:          'Friday Night Live',
        day:           'Friday',
        days:          ['Friday'],
        startTime:     '21:00',
        duration:      180,
        slotType:      'Headline',
        startDate:     '',
        endDate:       '',
        continuous:    true,
        ongoing:       true,
        feeMin:        '500',
        feeMax:        '1200',
        feeBasis:      'Per act',
        loadIn:        '19:00',
        soundcheck:    '19:30',
        room:          'The Back Room',
        genres:        ['Rock', 'Indie', 'Blues', 'Soul / R&B'],
        notes:         'One headline act, 2 to 3 sets. Originals and covers welcome. PA and house engineer provided.',
        paymentModel:  'Flat fee',
        paymentModels: ['Flat fee'],
        doorSplit:     '',
        coverCharge:   '',
        barSplit:      '',
        ticketSalesSplit:   '',
        ticketingHandledBy: 'Venue',
        negotiable:    true,
        paymentMethod: 'Bank transfer',
        paymentMethods: ['Bank transfer'],
        minNotice:     '1 week',
        useVenueGenres:         false,
        useDefaultPay:          false,
        useDefaultHospitality:  false,
        guestList:      '2',
        meals:          false,
        mealsDetails:   '',
        drinks:         true,
        drinksDetails:  'Drink tabs negotiated per booking. Minimum 4 x beers or waters on stage.',
        guaranteeAmount: '',
        guaranteeSplit:  '',
      },
      {
        name:          'Saturday Night Sessions',
        day:           'Saturday',
        days:          ['Saturday'],
        startTime:     '21:30',
        duration:      180,
        slotType:      'Headline',
        startDate:     '',
        endDate:       '',
        continuous:    true,
        ongoing:       true,
        feeMin:        '600',
        feeMax:        '1500',
        feeBasis:      'Per act',
        loadIn:        '19:30',
        soundcheck:    '20:00',
        room:          'The Back Room',
        genres:        ['Rock', 'Indie', 'Blues', 'Soul / R&B', 'Funk'],
        notes:         'Our busiest night. Looking for acts with a strong draw. Full fee negotiated per booking.',
        paymentModel:  'Flat fee',
        paymentModels: ['Flat fee'],
        doorSplit:     '',
        coverCharge:   '',
        barSplit:      '',
        ticketSalesSplit:   '',
        ticketingHandledBy: 'Venue',
        negotiable:    true,
        paymentMethod: 'Bank transfer',
        paymentMethods: ['Bank transfer'],
        minNotice:     '2 weeks',
        useVenueGenres:         false,
        useDefaultPay:          false,
        useDefaultHospitality:  false,
        guestList:      '4',
        meals:          true,
        mealsDetails:   'Meal voucher provided per performer. Kitchen closes 9 pm.',
        drinks:         true,
        drinksDetails:  'Drink tab included. Beers and non-alcoholic only.',
        guaranteeAmount: '',
        guaranteeSplit:  '',
      },
    ],
    techSpecs: {
      paSystem:      'L-Acoustics 108P tops, 118S subs x2',
      mixConsole:    'Yamaha QL1 (FOH), Yamaha QL1 (monitor)',
      monitorType:   'Wedges',
      monitorMixes:  '3',
      micStands:     '6',
      drumKit:       'Pearl Export 5-piece with hardware (no cymbals)',
      backline:      ['PA system', 'Stage monitors', 'Microphones + stands', 'Drum kit', 'Lighting rig'],
      stageWidth:    '6',
      stageDepth:    '4',
      houseEngineer: true,
      curfew:        '1:00 am',
      loadingAccess: 'Side lane off Smith Street. Double doors 1.8m wide.',
      parking:       'Street parking on Langridge Street. No on-site parking.',
      greenRoom:     'Private greenroom with fridge, couch, and lockable door.',
      accessNotes:   'Fully accessible main entrance. Accessible bathroom on ground floor.',
      verifiedAt:    Date.now(),
      verified:      true,
    },
    payment: {
      models:          ['Flat fee'],
      setFeeMin:       '500',
      setFeeMax:       '1500',
      feeBasis:        'Per act',
      weekdayFeeMin:   '400',
      weekdayFeeMax:   '900',
      weekendFeeMin:   '600',
      weekendFeeMax:   '1500',
      doorSplit:            '',
      coverCharge:          '',
      splitNotes:           '',
      barSplit:             '',
      ticketSalesSplit:     '',
      ticketingHandledBy:   'Venue',
      backlineProvided:     ['PA system', 'Stage monitors', 'Microphones + stands', 'Drum kit', 'Lighting rig'],
      guestListAllowance:   '2 to 4 per act',
      mealsProvided:        true,
      mealsNotes:           'Meal voucher per performer on Saturday nights.',
      paymentMethods:       ['Bank transfer'],
      timing:               'Within 7 days',
      timingOther:          '',
      depositRequired:      false,
      depositAmount:        '',
      depositDue:           '',
      abn:                  '',
      gstRegistered:        false,
      requiresArtistAbn:    false,
      invoiceRequired:      true,
      invoiceDirection:     'Artist invoices venue',
      invoiceDocs:          [],
      cancellationTerms:    '48 hours notice required for cancellation. No-shows forfeit the agreed fee.',
      publicLiability:      'Preferred',
      latePaymentContact:   'accounts@example.com',
      additionalNotes:      'We respond to all enquiries within 48 hours. Preferred acts are Melbourne-based with at least 1 year of gigging history.',
    },
    bookingTerms: {
      payModels:       ['Flat fee'],
      negotiable:      true,
      flatFeeMin:      '500',
      flatFeeMax:      '1500',
      flatFeeBasis:    'Per act',
      doorSplit:       '',
      guaranteeAmount: '',
      guaranteeSplit:  '',
      barSplit:        '',
      ticketSplitPct:  '',
      ticketingBy:     'Venue',
      methods:         ['Bank transfer'],
      paymentTiming:   'Within 7 days',
      depositRequired: false,
      depositAmount:   '',
      depositDue:      '',
      minNotice:       '1 week',
      guestList:       '2',
      meals:           false,
      mealsDetails:    '',
      drinks:          true,
      drinksDetails:   '4 x drinks per act minimum.',
      reqAbn:          false,
      showPayPublicly: true,
    },
    photos:       [],
    videos:       [],
    videoObjects: [],
    settings: {
      emailOnNewEnquiry:     true,
      emailEnquiryReminders: true,
      listed:                true,
      emailOnNewMessage:     true,
      reminderHours:         '48',
    },
    onboardingComplete: true,
    slots:              {},
    createdAt:          FieldValue.serverTimestamp(),
    updatedAt:          FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.doc('venues/' + venueId + '/private/details').set({
    phone:                '+61 3 9417 2345',
    email,
    bookingContactPhone:  '+61 412 987 654',
    accountsContactEmail: 'accounts@example.com',
  });

  await db.doc('users/' + uid).set({
    type:        'venue',
    displayName: 'The Coalface',
    username,
    email,
    venueId,
    claimStatus: 'approved',
    createdAt:   FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log('  Venue profile written. venueId:', venueId);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await seedArtist();
    await seedVenue();
    console.log('\nDone. Both test accounts are ready.');
    console.log('  Artist  — email: twayloartist@example.com   password: twayloartist');
    console.log('  Venue   — email: twaylovenue@example.com    password: twaylovenue');
  } catch (e) {
    console.error('\nError:', e);
    process.exit(1);
  }
}

main();
