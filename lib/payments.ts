/**
 * Client-side payment helpers.
 * Read-only: the client never recomputes payment.status.
 * It only reads what the Cloud Functions have stored.
 */
import { type GigFee, type Gig } from './gig-types';

// ── paymentExpectation ────────────────────────────────────────────────────────

export type PaymentExpectation = {
  mode: 'fixed' | 'variable' | 'none';
  expectedCents: number | null;
  isMinimum: boolean;
};

/**
 * Derives what kind of payment to expect from a GigFee.
 *
 * flat                 -> fixed,    agreedFeeCents
 * guarantee_vs_door    -> variable, agreedFeeCents, isMinimum: true
 * door_split           -> variable, null
 * ticket_split         -> variable, null
 * other                -> fixed if amountCents set, else variable, null
 * unpaid               -> none
 */
export function paymentExpectation(fee: GigFee): PaymentExpectation {
  switch (fee.type) {
    case 'flat':
      return { mode: 'fixed', expectedCents: fee.amountCents ?? null, isMinimum: false };
    case 'guarantee_vs_door':
      return { mode: 'variable', expectedCents: fee.amountCents ?? null, isMinimum: true };
    case 'door_split':
    case 'ticket_split':
      return { mode: 'variable', expectedCents: null, isMinimum: false };
    case 'other':
      return fee.amountCents != null
        ? { mode: 'fixed',    expectedCents: fee.amountCents, isMinimum: false }
        : { mode: 'variable', expectedCents: null,            isMinimum: false };
    case 'unpaid':
      return { mode: 'none', expectedCents: null, isMinimum: false };
    default:
      return { mode: 'variable', expectedCents: null, isMinimum: false };
  }
}

// ── isPaymentActive ───────────────────────────────────────────────────────────

/**
 * Whether the payment action is currently available.
 * - timing 'before' or null: always active once the gig is confirmed
 * - timing 'after': only once the gig has ended (now >= endAt)
 */
export function isPaymentActive(gig: Gig, now: Date): boolean {
  const timing = gig.payment?.timing ?? null;
  if (timing === 'after') {
    const endAt = gig.endAt?.toDate();
    if (!endAt) return false;
    return now >= endAt;
  }
  return true;
}

// ── formatAud ─────────────────────────────────────────────────────────────────

/**
 * Formats integer cents as an AUD string.
 * "$400" for whole dollars, "$400.50" when cents are non-zero.
 */
export function formatAud(cents: number): string {
  const dollars = cents / 100;
  const whole   = Math.floor(dollars);
  const rem     = Math.round((dollars - whole) * 100);
  if (rem === 0) return `$${whole}`;
  return `$${whole}.${String(rem).padStart(2, '0')}`;
}

// ── moneyState ────────────────────────────────────────────────────────────────

export type MoneyState = {
  state: 'pending' | 'confirmed' | 'disputed' | 'self_reported' | 'none';
  amountCents: number | null;
  isMinimum: boolean;
};

/**
 * Derives the dashboard money state from a gig.
 * The client reads this; it never recomputes payment.status itself.
 *
 * - 'none'         if gig.status !== 'confirmed', or fee mode is 'none'
 * - 'confirmed'    -> confirmedAmountCents
 * - 'self_reported'-> confirmedAmountCents
 * - 'disputed'     -> expected amount (may be null)
 * - 'pending'      -> expected amount, but only when gig.listAsBooked is true
 */
export function moneyState(gig: Gig): MoneyState {
  const none: MoneyState = { state: 'none', amountCents: null, isMinimum: false };

  if (gig.status !== 'confirmed') return none;

  const expectation = paymentExpectation(gig.fee);
  if (expectation.mode === 'none') return none;

  const ps = gig.payment?.status;
  if (!ps || ps === 'not_applicable') return none;

  if (ps === 'confirmed' || ps === 'self_reported') {
    return {
      state:       ps,
      amountCents: gig.payment.confirmedAmountCents ?? null,
      isMinimum:   false,
    };
  }

  if (ps === 'disputed') {
    return {
      state:       'disputed',
      amountCents: expectation.expectedCents,
      isMinimum:   expectation.isMinimum,
    };
  }

  // pending: only counts when listAsBooked is true
  if (!gig.listAsBooked) return none;

  return {
    state:       'pending',
    amountCents: expectation.expectedCents,
    isMinimum:   expectation.isMinimum,
  };
}
