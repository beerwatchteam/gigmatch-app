/**
 * Fixes the venue timetable slots:
 *   1. Adds recurring open template entries (no date field) so the timetable
 *      generates open slots for every Friday and Saturday automatically.
 *   2. Fixes time format on all existing date-specific entries from 24-hour
 *      ("21:00") to 12-hour AM/PM ("9:00 PM") which the timetable expects.
 */

const { readFileSync } = require('fs');
const { resolve }      = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const keyPath = resolve(__dirname, 'scripts:scripts1serviceAccountKey.json');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

// ── Recurring open templates (NO date field — appear every week) ──────────────
const FRIDAY_OPEN = {
  id:            'open-friday-0',
  time:          '9:00 PM',
  status:        'open',
  name:          'Friday Night Live',
  slotType:      'Headline',
  room:          'The Back Room',
  feeMin:        500,
  feeMax:        1200,
  feeBasis:      'Per act',
  paymentModels: ['Flat fee'],
  paymentMethod: 'Bank transfer',
  genres:        ['Rock', 'Indie', 'Blues', 'Soul / R&B'],
  duration:      180,
  loadIn:        '19:00',
  soundcheck:    '19:30',
  notes:         'One headline act, 2 to 3 sets. PA and house engineer provided.',
  startDate:     '',
  endDate:       '',
  continuous:    true,
  minNotice:     '1 week',
};

const SAT_OPEN = {
  id:            'open-saturday-0',
  time:          '9:30 PM',
  status:        'open',
  name:          'Saturday Night Sessions',
  slotType:      'Headline',
  room:          'The Back Room',
  feeMin:        600,
  feeMax:        1500,
  feeBasis:      'Per act',
  paymentModels: ['Flat fee'],
  paymentMethod: 'Bank transfer',
  genres:        ['Rock', 'Indie', 'Blues', 'Soul / R&B', 'Funk'],
  duration:      180,
  loadIn:        '19:30',
  soundcheck:    '20:00',
  notes:         'Our busiest night. Strong draw appreciated.',
  startDate:     '',
  endDate:       '',
  continuous:    true,
  minNotice:     '2 weeks',
};

// ── Time format fixer (24hr -> 12hr AM/PM) ────────────────────────────────────
function fixTime(t) {
  if (!t) return t;
  if (t === '21:00') return '9:00 PM';
  if (t === '21:30') return '9:30 PM';
  if (t === '20:00') return '8:00 PM';
  if (t === '19:00') return '7:00 PM';
  if (t === '19:30') return '7:30 PM';
  return t;
}

async function main() {
  const snap  = await db.doc('venues/twaylovenue').get();
  const slots = { ...(snap.data().slots || {}) };

  // Fix time format on all existing date-specific entries
  for (const day of Object.keys(slots)) {
    slots[day] = slots[day].map(s => ({ ...s, time: fixTime(s.time) }));
  }

  // Prepend the recurring open template for each day (strip any old copy first)
  slots['Friday']   = [FRIDAY_OPEN, ...(slots['Friday']   || []).filter(s => s.id !== 'open-friday-0')];
  slots['Saturday'] = [SAT_OPEN,    ...(slots['Saturday'] || []).filter(s => s.id !== 'open-saturday-0')];

  await db.doc('venues/twaylovenue').update({ slots });

  console.log('Done.\n');
  console.log('Friday entries:');
  slots['Friday'].forEach(s => console.log(' ', s.date ? s.date + ' [' + s.status + '] ' + (s.actName || '') : '(recurring open) ' + s.name));
  console.log('\nSaturday entries:');
  slots['Saturday'].forEach(s => console.log(' ', s.date ? s.date + ' [' + s.status + '] ' + (s.actName || '') : '(recurring open) ' + s.name));
}

main().catch(e => { console.error(e); process.exit(1); });
