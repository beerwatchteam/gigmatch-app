export type DueTiming = 'on_night' | 'within_days';

/**
 * Structured fee negotiation fields stored on the enquiry document under
 * `enquiryFee`. All fields are optional / nullable — filled progressively
 * as both parties negotiate in the Details drawer.
 *
 * Distinct from GigFee (the confirmed, immutable fee written to the gig doc
 * at confirmation time). All money is in cents, excluding GST.
 */
export type EnquiryFee = {
  /** Flat fee or guarantee amount (cents, ex-GST). */
  amountCents:      number | null;
  /** Artist's % share for door / ticket / guarantee+door splits (0–100). */
  doorPercent:      number | null;
  /** Per-ticket price in cents. ticket_split only. */
  ticketPriceCents: number | null;
  /** guarantee_vs_door: door % kicks in only above this amount (cents). */
  thresholdCents:   number | null;
  /** door_split / guarantee_vs_door: how door takings are calculated. */
  deductionsText:   string;
  /** ticket_split: venue sends artist a sales report within this many days. */
  reportDays:       number | null;
  /** unpaid: what the artist receives instead of money. */
  unpaidNotes:      string;
  /** How payment is transferred (e.g. "Bank transfer"). */
  channel:          string;
  /** When payment is due. */
  dueTiming:        DueTiming | null;
  /** Days after the gig when dueTiming is 'within_days'. */
  dueDays:          number | null;
  /** Whether GST applies to the agreed amount. */
  gstApplies:       boolean;
};

export const BLANK_ENQUIRY_FEE: EnquiryFee = {
  amountCents:      null,
  doorPercent:      null,
  ticketPriceCents: null,
  thresholdCents:   null,
  deductionsText:   '',
  reportDays:       null,
  unpaidNotes:      '',
  channel:          '',
  dueTiming:        null,
  dueDays:          null,
  gstApplies:       false,
};
