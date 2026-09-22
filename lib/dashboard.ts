/**
 * Dashboard data layer.
 *
 * All aggregation is client-side, computed from a single gigs fetch per
 * period. No new Cloud Functions.
 *
 * Depends on:
 *  - lib/payments.ts  (moneyState, formatAud) — payment brief
 *  - lib/agentRoster.ts (getRosterGigs)        — agent roster-read brief
 */

import {
  collection, getDocs, getDoc, doc, query, where, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Gig, GigSource, FeeType } from './gig-types';
import { moneyState } from './payments';
import { getRosterGigs, type RosterGig, type AgentRosterEntry } from './agentRoster';
import { toZonedTime } from 'date-fns-tz';

// ── Period ─────────────────────────────────────────────────────────────────

export type Period = {
  start: Timestamp;
  end:   Timestamp;
  label: string;
};

function ts(year: number, month: number, day: number): Timestamp {
  return Timestamp.fromDate(new Date(year, month, day, 0, 0, 0, 0));
}

export const PERIOD_PRESETS: Record<string, () => Period> = {

  this_month() {
    const n = new Date();
    const y = n.getFullYear(), m = n.getMonth();
    const [ny, nm] = m === 11 ? [y + 1, 0] : [y, m + 1];
    return {
      start: ts(y, m, 1),
      end:   ts(ny, nm, 1),
      label: new Date(y, m, 1).toLocaleString('en-AU', { month: 'long', year: 'numeric' }),
    };
  },

  last_month() {
    const n = new Date();
    const [y, m] = n.getMonth() === 0
      ? [n.getFullYear() - 1, 11]
      : [n.getFullYear(), n.getMonth() - 1];
    const [ny, nm] = m === 11 ? [y + 1, 0] : [y, m + 1];
    return {
      start: ts(y, m, 1),
      end:   ts(ny, nm, 1),
      label: new Date(y, m, 1).toLocaleString('en-AU', { month: 'long', year: 'numeric' }),
    };
  },

  this_quarter() {
    const n  = new Date();
    const y  = n.getFullYear();
    const q  = Math.floor(n.getMonth() / 3);
    const sm = q * 3;
    const em = sm + 3;
    const [ey, enm] = em >= 12 ? [y + 1, 0] : [y, em];
    return {
      start: ts(y, sm, 1),
      end:   ts(ey, enm, 1),
      label: `Q${q + 1} ${y}`,
    };
  },

  this_fy() {
    // Australian FY: 1 Jul – 30 Jun
    const n = new Date();
    const fyStart = n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1;
    return {
      start: ts(fyStart, 6, 1),
      end:   ts(fyStart + 1, 6, 1),
      label: `FY ${fyStart}\u2013${String(fyStart + 1).slice(2)}`,
    };
  },

  last_fy() {
    const n = new Date();
    const fyStart = (n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1) - 1;
    return {
      start: ts(fyStart, 6, 1),
      end:   ts(fyStart + 1, 6, 1),
      label: `FY ${fyStart}\u2013${String(fyStart + 1).slice(2)}`,
    };
  },
};

// ── getDashboardGigs ─────────────────────────────────────────────────────────

/**
 * One-shot fetch of all gigs for uid within the period.
 *
 * Query: participantIds array-contains uid, startAt >= period.start,
 *        startAt < period.end.
 *
 * Cancelled filter note: Firestore cannot combine array-contains + startAt
 * range + status inequality in a single query. Cancelled gigs are returned
 * by Firestore and discarded client-side. The cost is at most a handful of
 * extra reads per period, acceptable at current roster sizes.
 *
 * Composite index: participantIds (array-contains) + startAt (asc).
 * This is shared with the live listener in app/(tabs)/gigs.tsx and should
 * already exist in Firestore.
 */
export async function getDashboardGigs(uid: string, period: Period): Promise<Gig[]> {
  const snap = await getDocs(query(
    collection(db, 'gigs'),
    where('participantIds', 'array-contains', uid),
    where('startAt', '>=', period.start),
    where('startAt', '<',  period.end),
  ));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Gig))
    .filter(g => g.status !== 'cancelled');
}

// ── formatAud (local copy — avoids re-export dance) ─────────────────────────

export function formatAud(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rem   = Math.round(((cents / 100) - whole) * 100);
  return rem === 0 ? `$${whole}` : `$${whole}.${String(rem).padStart(2, '0')}`;
}

// ── gigRowDisplay ────────────────────────────────────────────────────────────

export type MoneyStateLabel =
  | 'confirmed' | 'self_reported' | 'pending' | 'disputed' | 'none';

export type GigRowDisplay = {
  planned: string;         // e.g. "Flat $400" or "Door split 60%"
  actual:  string;         // e.g. "$400" or "—"
  status:  MoneyStateLabel;
};

/**
 * Returns the planned deal string, actual confirmed amount, and status label
 * for one row in the gig table.
 *
 * planned  what the fee terms say — always present
 * actual   confirmed amount when payment.status is confirmed/self_reported,
 *          otherwise "—"
 * status   money state label
 */
export function gigRowDisplay(gig: Gig): GigRowDisplay {
  const fee = gig.fee;
  const ms  = moneyState(gig);

  let planned: string;
  switch (fee?.type) {
    case 'flat':
      planned = `Flat ${fee.amountCents != null ? formatAud(fee.amountCents) : ''}`.trim();
      break;
    case 'guarantee_vs_door':
      planned = `Guarantee ${fee.amountCents != null ? formatAud(fee.amountCents) : ''}`.trim();
      break;
    case 'door_split':
      planned = `Door split ${fee.doorPercent != null ? `${fee.doorPercent}%` : ''}`.trim();
      break;
    case 'ticket_split':
      planned = `Ticket split ${fee.amountCents != null ? formatAud(fee.amountCents) : ''}`.trim();
      break;
    case 'unpaid':
      planned = 'Unpaid';
      break;
    case 'other':
      planned = fee.amountCents != null ? formatAud(fee.amountCents) : 'Other';
      break;
    default:
      planned = 'Other';
  }

  const actual =
    (ms.state === 'confirmed' || ms.state === 'self_reported') && ms.amountCents != null
      ? formatAud(ms.amountCents)
      : '\u2014';

  return { planned, actual, status: ms.state };
}

// ── DashboardSummary ─────────────────────────────────────────────────────────

export type ByMonth = {
  month:          string;   // e.g. "Nov 2026" — in venue/gig timezone, not UTC
  confirmedCents: number;
  pendingCents:   number;
};

export type ByCounterparty = {
  id:             string;
  name:           string;
  count:          number;
  confirmedCents: number;
};

export type BySource = {
  source: GigSource;
  count:  number;
};

export type ByFeeType = {
  feeType:        FeeType;
  count:          number;
  confirmedCents: number;
};

export type DashboardSummary = {
  /** Gigs whose endAt is in the past. */
  gigsPlayed:          number;
  /** Gigs whose endAt is in the future (or unknown). */
  gigsUpcoming:        number;
  /**
   * Sum of confirmed + self_reported amounts.
   * Never includes pending or disputed.
   */
  confirmedCents:      number;
  /** Subset of confirmedCents that are self_reported. Labelled individually
   *  in the gig table; included in confirmedCents for headline totals. */
  selfReportedCents:   number;
  /** Sum of pending amounts (fee terms, not yet confirmed). */
  pendingCents:        number;
  /** Sum of disputed expected amounts. Excluded from both totals. */
  disputedCents:       number;
  /** Number of disputed gigs. */
  disputedCount:       number;
  /**
   * Gigs where moneyState returns 'none' (unpaid or no fee set).
   * Shown as a count — never treated as $0 in totals.
   */
  noFeeCount:          number;
  /** Monthly breakdown in the gig's own timezone, sorted chronologically. */
  byMonth:             ByMonth[];
  /** Counterparty breakdown: venues for artists, artists for venues. */
  byCounterparty:      ByCounterparty[];
  bySource:            BySource[];
  byFeeType:           ByFeeType[];
};

/**
 * Pure aggregation over an array of gigs.
 *
 * role — determines which side of the booking is "counterparty":
 *   'artist' -> counterparty = venue (venueName / venueId)
 *   'venue'  -> counterparty = artist (artistName / artistUid)
 *
 * viewerTimezone — used as fallback for gigs that lack their own timezone.
 * Monthly bucketing always uses gig.timezone when available (H.6 in brief).
 */
export function summarizeGigs(
  gigs: Gig[],
  role: 'artist' | 'venue',
  viewerTimezone = 'Australia/Melbourne',
): DashboardSummary {
  const now = new Date();

  let gigsPlayed        = 0;
  let gigsUpcoming      = 0;
  let confirmedCents    = 0;
  let selfReportedCents = 0;
  let pendingCents      = 0;
  let disputedCents     = 0;
  let disputedCount     = 0;
  let noFeeCount        = 0;

  const monthMap        = new Map<string, ByMonth>();
  const counterpartyMap = new Map<string, ByCounterparty>();
  const sourceMap       = new Map<GigSource, BySource>();
  const feeTypeMap      = new Map<string, ByFeeType>();

  for (const gig of gigs) {
    // Played vs upcoming
    const endDate = gig.endAt?.toDate()
      ?? new Date(gig.startAt.toDate().getTime() + 3_600_000);
    if (endDate < now) gigsPlayed++; else gigsUpcoming++;

    // Money state
    const ms = moneyState(gig);
    if (ms.state === 'none') {
      noFeeCount++;
    } else if (ms.state === 'confirmed') {
      confirmedCents += ms.amountCents ?? 0;
    } else if (ms.state === 'self_reported') {
      confirmedCents    += ms.amountCents ?? 0;
      selfReportedCents += ms.amountCents ?? 0;
    } else if (ms.state === 'pending') {
      pendingCents += ms.amountCents ?? 0;
    } else if (ms.state === 'disputed') {
      disputedCents += ms.amountCents ?? 0;
      disputedCount++;
    }

    // Monthly bucketing — use gig timezone, fall back to viewer timezone
    const tz         = gig.timezone ?? viewerTimezone;
    const localStart = toZonedTime(gig.startAt.toDate(), tz);
    // Pad month to ensure lexicographic sort is chronological
    const monthKey   = `${localStart.getFullYear()}-${String(localStart.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = localStart.toLocaleString('en-AU', { month: 'short', year: 'numeric' });
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, { month: monthLabel, confirmedCents: 0, pendingCents: 0 });
    }
    const mEntry = monthMap.get(monthKey)!;
    if (ms.state === 'confirmed' || ms.state === 'self_reported') {
      mEntry.confirmedCents += ms.amountCents ?? 0;
    } else if (ms.state === 'pending') {
      mEntry.pendingCents += ms.amountCents ?? 0;
    }

    // Counterparty
    const cpId   = role === 'artist'
      ? (gig.venueId  ?? '__no_venue')
      : (gig.artistUid ?? '__no_artist');
    const cpName = role === 'artist'
      ? (gig.venueName  ?? 'Unknown venue')
      : (gig.artistName ?? gig.bandName ?? 'Unknown artist');
    if (!counterpartyMap.has(cpId)) {
      counterpartyMap.set(cpId, { id: cpId, name: cpName, count: 0, confirmedCents: 0 });
    }
    const cp = counterpartyMap.get(cpId)!;
    cp.count++;
    if (ms.state === 'confirmed' || ms.state === 'self_reported') {
      cp.confirmedCents += ms.amountCents ?? 0;
    }

    // Source
    if (!sourceMap.has(gig.source)) {
      sourceMap.set(gig.source, { source: gig.source, count: 0 });
    }
    sourceMap.get(gig.source)!.count++;

    // Fee type
    const ft = (gig.fee?.type ?? 'other') as FeeType;
    if (!feeTypeMap.has(ft)) {
      feeTypeMap.set(ft, { feeType: ft, count: 0, confirmedCents: 0 });
    }
    const ftEntry = feeTypeMap.get(ft)!;
    ftEntry.count++;
    if (ms.state === 'confirmed' || ms.state === 'self_reported') {
      ftEntry.confirmedCents += ms.amountCents ?? 0;
    }
  }

  const byMonth = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  return {
    gigsPlayed, gigsUpcoming,
    confirmedCents, selfReportedCents,
    pendingCents,
    disputedCents, disputedCount,
    noFeeCount,
    byMonth,
    byCounterparty: Array.from(counterpartyMap.values()).sort((a, b) => b.count - a.count),
    bySource:       Array.from(sourceMap.values()),
    byFeeType:      Array.from(feeTypeMap.values()),
  };
}

// ── EnquiryStats ─────────────────────────────────────────────────────────────

export type EnquiryStats = {
  total:          number;
  accepted:       number;
  declined:       number;
  acceptanceRate: number | null;  // null when no enquiries
  avgReplyMs:     number | null;  // venue only, from venues/{id}.replyStats
};

/**
 * Fetch enquiry stats for an artist or venue within the given period.
 *
 * Query note: period filtering is done client-side to avoid composite index
 * requirements on submittedAt alongside createdBy / venueId. Acceptable at
 * current enquiry volumes.
 *
 * avgReplyMs (venue only) is read from the replyStats field written by
 * lib/useEnquiries.ts:updateEnquiryStatus — see audit report section A.3.
 */
export async function getEnquiryStats(
  uid: string,
  role: 'artist' | 'venue',
  period: Period,
  venueId?: string | null,
): Promise<EnquiryStats> {
  const q = role === 'artist'
    ? query(collection(db, 'inquiries'), where('createdBy', '==', uid))
    : query(collection(db, 'inquiries'), where('venueId',   '==', venueId ?? uid));

  const snap = await getDocs(q);

  // Filter to period client-side using submittedAt (ISO string, lexicographically sortable)
  const periodStart = period.start.toDate().getTime();
  const periodEnd   = period.end.toDate().getTime();
  const docs = snap.docs
    .map(d => d.data())
    .filter(d => {
      if (!d.submittedAt) return false;
      const t = new Date(d.submittedAt).getTime();
      return t >= periodStart && t < periodEnd;
    });

  const total    = docs.length;
  const accepted = docs.filter(d => ['confirmed', 'accepted'].includes(d.status)).length;
  const declined = docs.filter(d => d.status === 'declined').length;

  let avgReplyMs: number | null = null;
  if (role === 'venue' && venueId) {
    try {
      const vSnap = await getDoc(doc(db, 'venues', venueId));
      if (vSnap.exists()) {
        const rs = vSnap.data().replyStats as { totalMs?: number; count?: number } | undefined;
        if (rs && rs.count && rs.count > 0 && rs.totalMs != null) {
          avgReplyMs = rs.totalMs / rs.count;
        }
      }
    } catch { /* best-effort */ }
  }

  return {
    total,
    accepted,
    declined,
    acceptanceRate: total > 0 ? accepted / total : null,
    avgReplyMs,
  };
}

// ── RosterDashboard ───────────────────────────────────────────────────────────

export type RosterEntitySummary = {
  entity:  AgentRosterEntry;
  summary: DashboardSummary;
  gigs:    RosterGig[];
};

export type RosterDashboard = {
  /** Aggregate across all roster clients. No gig is double-counted
   *  even when the agent represents both sides of the same booking. */
  total:    DashboardSummary;
  /** Per-client breakdown. */
  entities: RosterEntitySummary[];
};

/**
 * Fetches all roster gigs, filters to period, and returns a combined summary
 * plus per-entity breakdowns.
 *
 * De-duplication: getRosterGigs assigns each gig a single rosterEntity
 * (artist side wins when both sides are represented). The total therefore
 * never double-counts a gig, even when the agent represents both parties.
 *
 * Fee visibility: agent reads fee/payment data directly from the gig doc
 * (see brief section D / audit report). If this is later restricted, the
 * money figures here will need a Cloud Function reading private/{uid}.
 */
export async function getRosterDashboard(
  agentUid: string,
  period: Period,
): Promise<RosterDashboard> {
  const allGigs = await getRosterGigs(agentUid);

  const periodStartMs = period.start.toDate().getTime();
  const periodEndMs   = period.end.toDate().getTime();

  const inPeriod = allGigs.filter(g => {
    if (g.status === 'cancelled') return false;
    const t = g.startAt.toDate().getTime();
    return t >= periodStartMs && t < periodEndMs;
  });

  // Per-entity grouping
  const entityMap = new Map<string, { entry: AgentRosterEntry; gigs: RosterGig[] }>();
  for (const gig of inPeriod) {
    const id = gig.rosterEntity.id;
    if (!entityMap.has(id)) entityMap.set(id, { entry: gig.rosterEntity, gigs: [] });
    entityMap.get(id)!.gigs.push(gig);
  }

  const entities: RosterEntitySummary[] = Array.from(entityMap.values()).map(
    ({ entry, gigs }) => ({
      entity: entry,
      summary: summarizeGigs(gigs, entry.type === 'venue' ? 'venue' : 'artist'),
      gigs,
    }),
  );

  // Total: summarize all de-duped gigs; use 'artist' role for counterparty
  // breakdown (shows venues for artist gigs; mixed for venue gigs — intended
  // for the rollup card which doesn't expose byCounterparty).
  const total = summarizeGigs(inPeriod, 'artist');

  return { total, entities };
}
