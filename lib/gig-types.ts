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
  includesGst?: boolean | null;  // null / omitted = not specified
};

// ── Payment types ────────────────────────────────────────────────────────────

export type PaymentTiming = 'before' | 'after';
export type PaymentStatus = 'pending' | 'disputed' | 'confirmed' | 'self_reported' | 'not_applicable';

export type PaymentConfirmation = {
  amountCents: number;
  at: Timestamp;
  by: string;
};

export type GigPayment = {
  /** null on single-party gigs (venue_created, artist_added) */
  timing: PaymentTiming | null;
  /** Pending timing change proposal; null when none */
  timingProposal: {
    proposedBy: string;
    timing: PaymentTiming;
    proposedAt: Timestamp;
  } | null;
  status: PaymentStatus;
  venueConfirm: PaymentConfirmation | null;
  /** Single-party gigs use whichever role the owner has */
  artistConfirm: PaymentConfirmation | null;
  confirmedAmountCents: number | null;
  confirmedAt: Timestamp | null;
  reminderSentAt: Timestamp | null;
  updatedAt: Timestamp;
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
  payment: GigPayment;
  participantIds: string[];
  createdBy: string;
  listAsBooked: boolean;
  attendance?: number | null;
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

/**
 * Convert a dollar string or number to integer cents (rounds half-up).
 * Returns null for empty input, non-numeric values, or negative amounts.
 * Strips commas before parsing (e.g. "1,200" -> 120000).
 * Result is always Number.isInteger when non-null.
 */
export function dollarsToCents(dollars: string | number): number | null {
  if (dollars === '' || dollars == null) return null;
  const s = typeof dollars === 'string' ? dollars.replace(/,/g, '') : String(dollars);
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Parse "H:MM AM/PM" (12h) into [hour24, minute].
 * Throws for bare 24-hour inputs (hour > 12) and unparseable strings.
 * A 24-hour "12:xx" is accepted as-is (noon/midnight must use AM/PM externally).
 */
function parseLocalTime(t: string): [number, number] {
  if (!t || typeof t !== 'string') throw new Error(`Invalid time: "${t}"`);
  const ampm = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(t.trim());
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    if (/PM/i.test(ampm[3]) && h !== 12) h += 12;
    if (/AM/i.test(ampm[3]) && h === 12) h = 0;
    return [h, m];
  }
  const parts = t.trim().split(':').map(Number);
  if (
    parts.length < 2 ||
    !Number.isFinite(parts[0]) ||
    !Number.isFinite(parts[1]) ||
    (parts[0] as number) > 12
  ) {
    throw new Error(`Invalid time format: "${t}". Use H:MM AM/PM.`);
  }
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

/**
 * Parse a set-length string into total minutes.
 * Supports: "45 min", "1 hr", "1.5 hours", "90" (bare number).
 * Returns null for empty or unparseable input.
 */
export function parseSetLength(s: string): number | null {
  if (s == null || s === '') return null;
  const t = s.trim();
  if (!t) return null;
  const hrMatch = /^([\d.]+)\s*(?:hr|hour)/i.exec(t);
  if (hrMatch) {
    const n = parseFloat(hrMatch[1]);
    return Number.isFinite(n) ? Math.round(n * 60) : null;
  }
  const minMatch = /^([\d.]+)\s*min/i.exec(t);
  if (minMatch) {
    const n = parseFloat(minMatch[1]);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  const num = parseFloat(t);
  if (/^[\d.]+$/.test(t) && Number.isFinite(num) && num > 0) return Math.round(num);
  return null;
}

/**
 * Validate a ticket URL: must be https protocol only.
 * Rejects http://, javascript:, bare domains, and empty strings.
 */
export function validateTicketUrl(url: string): boolean {
  if (!url || !url.trim()) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validate a door-split percentage: must be a finite number in [0, 100]. */
export function validateDoorSplitPct(pct: number): boolean {
  return Number.isFinite(pct) && pct >= 0 && pct <= 100;
}

/**
 * Validate a GigFee object.
 * Returns an error message string, or null if valid.
 * - flat / guarantee_vs_door / ticket_split: require amountCents
 * - door_split: requires doorPercent in [0, 100]
 * - unpaid / other: no requirements
 */
export function validateFee(fee: GigFee): string | null {
  if (
    fee.type === 'flat' ||
    fee.type === 'guarantee_vs_door' ||
    fee.type === 'ticket_split'
  ) {
    if (fee.amountCents == null || fee.amountCents < 0) {
      return 'A fee amount is required for this fee type.';
    }
  }
  if (fee.type === 'door_split') {
    if (fee.doorPercent == null || !validateDoorSplitPct(fee.doorPercent)) {
      return 'A valid door split percentage (0-100) is required.';
    }
  }
  return null;
}

