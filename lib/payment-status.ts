/**
 * Dashboard payment status derivation.
 *
 * This module is intentionally pure: no Firebase imports, no side effects.
 * All rules derive from the gig document and a supplied `today` date so the
 * caller controls the clock (easy to test, easy to freeze in the UI).
 *
 * Key rules (§2 of the dashboard handoff):
 *   1. not_applicable (unpaid) — excluded from dashboard.
 *   2. payment.status confirmed  → 'paid'
 *   3. payment.status self_reported → 'self_reported' (shown, labelled "Self-reported")
 *   4. Gig date is in the future → 'upcoming'
 *   5. Pure split with no confirmed amount → 'needsAmount'
 *   6. Legacy doc (no terms.timing / no dueDate) → 'awaiting' (NEVER 'overdue')
 *   7. dueDate < today → 'overdue'
 *   8. Otherwise → 'due'
 *   9. payment.status disputed → 'disputed' ("Amounts don't match")
 *
 * Rule ordering: paid/self_reported are checked before upcoming, so a gig that
 * has been paid but is in the past is shown as 'paid', not 'due'.
 * Disputed is checked last — a dispute on an upcoming gig is still 'disputed'.
 */

import type { Gig } from './gig-types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PaymentDisplayStatus =
  | 'not_applicable'  // unpaid — caller should exclude from dashboard
  | 'paid'            // both sides confirmed, amounts match
  | 'self_reported'   // single-party gig, one side confirmed
  | 'upcoming'        // gig date is in the future
  | 'needsAmount'     // split gig that has been played, no amount entered yet
  | 'awaiting'        // legacy gig without terms — no due date, never overdue
  | 'due'             // due date is today or in the future
  | 'overdue'         // due date is in the past
  | 'disputed';       // both sides entered different amounts

export type PaymentStatusResult = {
  status:      PaymentDisplayStatus;
  /** ISO YYYY-MM-DD, or null when unknown (upcoming / awaiting / not_applicable). */
  dueDate:     string | null;
  /** Positive integer when overdue, null otherwise. */
  daysOverdue: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fee types that produce a variable amount — payment can only be recorded after the gig. */
const SPLIT_TYPES = new Set<Gig['fee']['type']>(['door_split', 'ticket_split', 'bar_split']);

/**
 * Parse an ISO date string to UTC midnight so comparisons are
 * calendar-day only and timezone-agnostic.
 * dueDate strings are already in the gig's local timezone (YYYY-MM-DD),
 * so we treat them as UTC calendar days for comparison purposes.
 */
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

/** Strip time component using UTC so the result is timezone-agnostic. */
function calendarDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ── paymentStatus ─────────────────────────────────────────────────────────────

/**
 * Derives the dashboard display status for a single confirmed gig.
 *
 * @param gig   A confirmed gig document (with optional terms and extended payment fields).
 * @param today The reference date (use `new Date()` in production; inject in tests).
 */
export function paymentStatus(gig: Gig, today: Date): PaymentStatusResult {
  const { fee, payment } = gig;
  const ps = payment.status;

  // ── Not applicable (unpaid gig) ──────────────────────────────────────────
  if (ps === 'not_applicable') {
    return { status: 'not_applicable', dueDate: null, daysOverdue: null };
  }

  const storedDueDate = payment.dueDate ?? null;

  // ── Paid ─────────────────────────────────────────────────────────────────
  if (ps === 'confirmed') {
    return { status: 'paid', dueDate: storedDueDate, daysOverdue: null };
  }

  // ── Self-reported (single-party gig) ─────────────────────────────────────
  if (ps === 'self_reported') {
    return { status: 'self_reported', dueDate: storedDueDate, daysOverdue: null };
  }

  // ── Disputed (amounts don't match) ───────────────────────────────────────
  // Checked before 'upcoming' so a future disputed gig shows 'disputed'.
  if (ps === 'disputed') {
    return { status: 'disputed', dueDate: storedDueDate, daysOverdue: null };
  }

  // ── Upcoming (gig date is in the future) ─────────────────────────────────
  const gigDate = calendarDay(gig.startAt.toDate());
  const todayDay = calendarDay(today);
  if (gigDate > todayDay) {
    return { status: 'upcoming', dueDate: storedDueDate, daysOverdue: null };
  }

  // ── Legacy doc: no terms snapshot → never overdue ────────────────────────
  // terms and dueDate are both required to derive due/overdue. If either is
  // missing the gig predates this feature; show 'awaiting' with no due date.
  // This check precedes needsAmount so legacy splits also show 'awaiting'.
  const hasTerms = !!(gig.terms && gig.terms.timing);
  if (!hasTerms || !storedDueDate) {
    return { status: 'awaiting', dueDate: null, daysOverdue: null };
  }

  // ── NeedsAmount (split gig played, no amount recorded) ───────────────────
  if (SPLIT_TYPES.has(fee.type) && payment.confirmedAmountCents == null) {
    return { status: 'needsAmount', dueDate: storedDueDate, daysOverdue: null };
  }

  // ── Overdue / Due ────────────────────────────────────────────────────────
  const dueDateDay = calendarDay(parseIsoDate(storedDueDate));
  const diffMs = todayDay.getTime() - dueDateDay.getTime();
  const daysOverdue = Math.floor(diffMs / 86_400_000);

  if (daysOverdue > 0) {
    return { status: 'overdue', dueDate: storedDueDate, daysOverdue };
  }

  return { status: 'due', dueDate: storedDueDate, daysOverdue: null };
}
