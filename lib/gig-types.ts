import { Timestamp } from 'firebase/firestore';
import { fromZonedTime } from 'date-fns-tz';

export type GigStatus = 'confirmed' | 'cancelled';
export type GigSource = 'enquiry' | 'venue_created' | 'artist_added';
export type FeeType   = 'flat' | 'door_split' | 'guarantee_vs_door' | 'ticket_split' | 'unpaid' | 'other';

export type GigFee = {
  type: FeeType;
  amountCents?: number;   // set when type is flat or guarantee_vs_door
  doorPercent?: number;   // 0-100
  ticketPrice?: number;   // cents
  ticketUrl?: string;
  notes?: string;
};

export type Gig = {
  id: string;                // Firestore doc id
  enquiryId: string;
  venueId: string;
  venueName: string;
  artistUid: string;
  bandName: string;
  status: GigStatus;
  source: GigSource;
  startAt: Timestamp;        // UTC Firestore Timestamp
  timezone: string;          // IANA e.g. "Australia/Sydney"
  setLengthMinutes: number;
  loadInTime?: string;       // "HH:MM" local
  soundCheckTime?: string;   // "HH:MM" local
  room?: string | null;
  fee: GigFee;
  participantIds: string[];  // [artistUid, venueOwnerUid, ...supportUids]
  notes?: string;
  listAsBooked: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/** Short display name for a given IANA timezone (Australian cities). */
const TZ_CITY: Record<string, string> = {
  'Australia/Perth':     'Perth time',
  'Australia/Darwin':    'Darwin time',
  'Australia/Adelaide':  'Adelaide time',
  'Australia/Brisbane':  'Brisbane time',
  'Australia/Sydney':    'Sydney time',
  'Australia/Melbourne': 'Melbourne time',
  'Australia/Hobart':    'Hobart time',
};

/**
 * Returns a short label like "Perth time" when the venue's timezone
 * differs from the viewer's device timezone.
 * Returns null when they match — no label needed.
 */
export function tzLabel(venueTimezone: string | undefined | null): string | null {
  if (!venueTimezone) return null;
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (deviceTz === venueTimezone) return null;
  return TZ_CITY[venueTimezone] ?? null;
}

/** IANA timezone lookup by Australian state code */
export const STATE_TZ: Record<string, string> = {
  NSW: 'Australia/Sydney',
  VIC: 'Australia/Melbourne',
  QLD: 'Australia/Brisbane',
  SA:  'Australia/Adelaide',
  WA:  'Australia/Perth',
  TAS: 'Australia/Hobart',
  NT:  'Australia/Darwin',
  ACT: 'Australia/Sydney',
};

/** Convert a dollar string or number to integer cents (rounds half-up). */
export function dollarsToCents(dollars: string | number): number {
  const n = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/**
 * Build a UTC Firestore Timestamp from a local YYYY-MM-DD date string and
 * an "HH:MM" time string, interpreted in the given IANA timezone.
 * Never pass `new Date("YYYY-MM-DD")` — that interprets as UTC midnight.
 *
 * Hermes (RN 0.73+) ships full Intl, so date-fns-tz works on iOS/Android.
 */
/** Parse "HH:MM" (24h) or "H:MM AM/PM" (12h) into [hour, minute]. */
function parseLocalTime(t: string): [number, number] {
  const ampm = /(\d+):(\d+)\s*(AM|PM)/i.exec(t);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    if (/PM/i.test(ampm[3]) && h !== 12) h += 12;
    if (/AM/i.test(ampm[3]) && h === 12) h = 0;
    return [h, m];
  }
  const parts = t.split(':').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0];
}

export function toStartAt(localDate: string, localTime: string, timezone: string): Timestamp {
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute]     = parseLocalTime(localTime);
  // fromZonedTime treats the Date as a local wall-clock time in `timezone`
  const utcDate = fromZonedTime(
    new Date(year, month - 1, day, hour, minute, 0, 0),
    timezone,
  );
  return Timestamp.fromDate(utcDate);
}
