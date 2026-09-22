/**
 * Shared fixture data for all test suites.
 *
 * UIDs are stable strings used across unit, rules, and function tests.
 * Admin SDK or withSecurityRulesDisabled should be used to write these
 * into the emulator before each test group.
 */

export const UID = {
  artistA:     'artistA-uid',
  artistB:     'artistB-uid',
  venueOwner1: 'venueOwner1-uid',
  venueOwner2: 'venueOwner2-uid',
  stranger:    'stranger-uid',
  admin:       'admin-uid',
} as const;

// ── Firestore documents ─────────────────────────────────────────────────────

export const USERS: Record<string, object> = {
  [UID.artistA]:     { type: 'artist',  displayName: 'Artist A' },
  [UID.artistB]:     { type: 'artist',  displayName: 'Artist B' },
  [UID.venueOwner1]: { type: 'venue',   displayName: 'Venue Owner 1', venueId: 'v1' },
  [UID.venueOwner2]: { type: 'venue',   displayName: 'Venue Owner 2', venueId: 'v2' },
  [UID.stranger]:    { type: 'artist',  displayName: 'Stranger' },
  [UID.admin]:       { type: 'admin',   displayName: 'Admin' },
};

/** Open Friday 8 PM template slot */
export const FRIDAY_SLOT = {
  day:        'Friday',
  time:       '8:00 PM',
  status:     'open',
  room:       'Main Room',
  duration:   45,
  loadIn:     '18:30',
  soundcheck: '17:30',
  feeMin:     300,
  feeMax:     500,
};

export const VENUES: Record<string, object> = {
  v1: {
    name:    'Test Venue 1',
    state:   'VIC',
    rooms:   [{ name: 'Main Room' }],
    slots:   { Friday: [{ ...FRIDAY_SLOT }] },
    email:   'venue1@test.com',
  },
  v2: {
    name:    'Test Venue 2',
    state:   'WA',
    rooms:   [{ name: 'Main Room' }],
    slots:   { Friday: [{ ...FRIDAY_SLOT }] },
    email:   'venue2@test.com',
  },
};

// ── Payment fixtures ─────────────────────────────────────────────────────────

/**
 * Fresh payment map for an enquiry gig (timing 'before').
 * Satisfies freshPayment() in firestore.rules.
 */
export const FRESH_PAYMENT_BEFORE = {
  timing:               'before' as const,
  timingProposal:       null,
  status:               'pending' as const,
  venueConfirm:         null,
  artistConfirm:        null,
  confirmedAmountCents: null,
  confirmedAt:          null,
  reminderSentAt:       null,
  updatedAt:            { _seconds: 1788220800, _nanoseconds: 0 }, // 2026-10-01
};

/**
 * Fresh payment map for an enquiry gig (timing 'after').
 */
export const FRESH_PAYMENT_AFTER = {
  ...FRESH_PAYMENT_BEFORE,
  timing: 'after' as const,
};

/**
 * Fresh payment map for single-party gigs (no timing concept).
 */
export const FRESH_PAYMENT_SINGLE = {
  ...FRESH_PAYMENT_BEFORE,
  timing: null as null,
};

/** enq1: artistA enquiry against venue v1, Friday 2026-11-14 8:00 PM */
export const ENQ1 = {
  createdBy:    UID.artistA,
  venueId:      'v1',
  venueName:    'Test Venue 1',
  bandName:     'Test Band',
  status:       'discussing',
  submittedAt:  '2026-10-01T00:00:00Z',
  requestedSlot: {
    day:       'Friday',
    date:      '2026-11-14',
    time:      '8:00 PM',
    setLength: '45 min',
    room:      'Main Room',
    slotType:  'Headline',
  },
};

/** enq2: artistB enquiry for the exact same slot/date (conflict test) */
export const ENQ2 = {
  ...ENQ1,
  createdBy: UID.artistB,
  bandName:  'Conflicting Band',
};

/** Seeded gig doc: enquiry source, owned by venueOwner1 / artistA */
export const GIG_ENQ1 = {
  source:        'enquiry',
  enquiryId:     'enq1',
  venueId:       'v1',
  venueName:     'Test Venue 1',
  venueUid:      UID.venueOwner1,
  artistUid:     UID.artistA,
  artistName:    'Test Band',
  bandName:      'Test Band',
  title:         null,
  description:   null,
  locationText:  null,
  state:         null,
  isPublic:      false,
  status:        'confirmed',
  startAt:       { _seconds: 1731574800, _nanoseconds: 0 }, // 2026-11-14T09:00:00Z
  endAt:         { _seconds: 1731577500, _nanoseconds: 0 }, // +45 min
  timezone:      'Australia/Melbourne',
  setLengthMinutes: 45,
  loadInTime:    '18:30',
  soundCheckTime: '17:30',
  room:          'Main Room',
  fee:           { type: 'flat', amountCents: 40000, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null, includesGst: null },
  payment:       FRESH_PAYMENT_BEFORE,
  participantIds: [UID.artistA, UID.venueOwner1],
  createdBy:     UID.venueOwner1,
  listAsBooked:  true,
};

/** Seeded gig doc: artist_added source, owned by artistA */
export const GIG_ARTIST_ADDED = {
  source:        'artist_added',
  enquiryId:     null,
  venueId:       null,
  venueName:     'Some Venue',
  venueUid:      null,
  artistUid:     UID.artistA,
  artistName:    'Test Band',
  bandName:      'Test Band',
  title:         'My gig',
  description:   null,
  locationText:  'Fitzroy, VIC',
  state:         'VIC',
  isPublic:      false,
  status:        'confirmed',
  startAt:       { _seconds: 1731574800, _nanoseconds: 0 },
  endAt:         { _seconds: 1731578400, _nanoseconds: 0 },
  timezone:      'Australia/Melbourne',
  setLengthMinutes: 60,
  loadInTime:    null,
  soundCheckTime: null,
  room:          null,
  fee:           { type: 'other', amountCents: null, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null, includesGst: null },
  payment:       FRESH_PAYMENT_SINGLE,
  participantIds: [UID.artistA],
  createdBy:     UID.artistA,
  listAsBooked:  false,
};

/** Seeded gig doc: venue_created source, owned by venueOwner1 */
export const GIG_VENUE_CREATED = {
  source:        'venue_created',
  enquiryId:     null,
  venueId:       'v1',
  venueName:     'Test Venue 1',
  venueUid:      UID.venueOwner1,
  artistUid:     null,
  artistName:    'Headline Act',
  bandName:      'Headline Act',
  title:         'Friday Night Live',
  description:   null,
  locationText:  null,
  state:         null,
  isPublic:      false,
  status:        'confirmed',
  startAt:       { _seconds: 1731574800, _nanoseconds: 0 },
  endAt:         { _seconds: 1731578400, _nanoseconds: 0 },
  timezone:      'Australia/Melbourne',
  setLengthMinutes: 60,
  loadInTime:    null,
  soundCheckTime: null,
  room:          'Main Room',
  fee:           { type: 'other', amountCents: null, doorPercent: null, ticketPriceCents: null, ticketUrl: null, notes: null, includesGst: null },
  payment:       FRESH_PAYMENT_SINGLE,
  participantIds: [UID.venueOwner1],
  createdBy:     UID.venueOwner1,
  listAsBooked:  false,
};
