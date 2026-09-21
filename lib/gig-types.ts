import { Timestamp } from 'firebase/firestore';
import { fromZonedTime } from 'date-fns-tz';

export type GigStatus  = 'confirmed' | 'cancelled';
export type GigSource  = 'enquiry' | 'venue_created' | 'artist_added';
export type FeeType    = 'flat' | 'door_split' | 'guarantee_vs_door' | 'ticket_split' | 'unpaid' | 'other';
export type GigDocKind = 'contract' | 'tech_spec' | 'stage_plot' | 'run_sheet' | 'invoice' | 'other';

export type GigFee = {
  type: FeeType;
  amountCents: number | null;
  doorPercent: number | null;
  ticketPriceCents: number | null;
  ticketUrl: string | null;
  notes: string | null;
};

/**
 * Core gig record.
 * - enquiry source: created by venue owner, participantIds = [artistUid, venueUid]
 * - venue_created:  created by venue owner, artistUid = null, isPublic always false
 * - artist_added:   created by artist,      participantIds = [artistUid]
 *
 * `notes` has moved to gigs/{id}/private/{uid}. Do not write it here.
 * Fee fields stay here so the dashboard can total them per-user.
 */
export type Gig = {
  id: string;
  enquiryId: string | null;
  venueId: string | null;
  venueName: string | null;
  venueUid: string | null;       // venue owner uid
  artistUid: string | null;      // null on venue_created gigs
  artistName: string | null;     // act name (free text on venue_created; mirrors bandName on enquiry)
  /** Kept for calendar-feed compat and legacy reads. */
  bandName: string;
  title: string | null;          // public event name
  description: string | null;    // public blurb
  locationText: string | null;   // artist_added: suburb/address free text
  state: string | null;          // artist_added: AU state code, drives timezone
  /** Artist's profile toggle. Always false when artistUid is null. */
  isPublic: boolean;
  status: GigStatus;
  source: GigSource;
  startAt: Timestamp;
  endAt: Timestamp | null;
  timezone: string;
  setLengthMinutes: number | null;
  loadInTime: string | null;     // "HH:MM" local
  soundCheckTime: string | null; // "HH:MM" local
  room: string | null;
  fee: GigFee;
  participantIds: string[];
  createdBy: string;
  listAsBooked: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/** Per-user private subcollection: gigs/{gigId}/private/{uid} */
export type GigPrivateDoc = {
  ownerUid: string;
  notes: string;
  docs: {
    id: string;
    kind: GigDocKind;
    name: string;
    url: string;
    storagePath: string;
    uploadedAt: Timestamp;
  }[];
  updatedAt: Timestamp;
};

/** Public projection written by the Cloud Function trigger. */
export type PublicGig = {
  gigId: string;
  artistUid: string;
  venueId: string | null;
  title: string | null;
  actName: string | null;
  venueName: string | null;
  room: string | null;
  locationText: string | null;
  state: string | null;
  date: string;              // YYYY-MM-DD local date
  startAt: Timestamp;
  endAt: Timestamp;
  timezone: string;
  description: string | null;
  ticketUrl: string | null;
  ticketPriceCents: number | null;
  source: 'enquiry' | 'artist_added';
};

// ── Timezone helpers ─────────────────────────────────────────────────────────

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
 * Returns a short label like "Perth time" when the venue's timezone differs
 * from the viewer's device timezone. Returns null when they match.
 */
export function tzLabel(venueTimezone: string | undefined | null): string | null {
  if (!venueTimezone) return null;
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (deviceTz === venueTimezone) return null;
  return TZ_CITY[venueTimezone] ?? null;
}

/** IANA timezone by Australian state code. */
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

/**
 * Build a UTC Firestore Timestamp from a local YYYY-MM-DD date string and
 * an "HH:MM" time string, interpreted in the given IANA timezone.
 * Never pass `new Date("YYYY-MM-DD")` — that interprets as UTC midnight.
 */
export function toStartAt(localDate: string, localTime: string, timezone: string): Timestamp {
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute]     = parseLocalTime(localTime);
  const utcDate = fromZonedTime(
    new Date(year, month - 1, day, hour, minute, 0, 0),
    timezone,
  );
  return Timestamp.fromDate(utcDate);
}
