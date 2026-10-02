import type { Enquiry } from './useEnquiries';

export type PaymentReadiness = {
  ready: boolean;
  missing: string[];
};

function stageOk(enquiry: Enquiry, key: string): boolean {
  const map = (enquiry as any).stages as
    | Record<string, { venueConfirmed?: boolean; artistConfirmed?: boolean; skipped?: boolean }>
    | undefined;
  const d = map?.[key];
  if (!d) return false;
  if (d.skipped) return true;
  return !!(d.venueConfirmed && d.artistConfirmed);
}

/**
 * Returns whether the Payment Terms stage is fully resolved
 * (both confirmed or skipped), plus a list of human-readable missing items.
 *
 * Used to gate gig confirmation and contract generation.
 */
export function isPaymentReady(enquiry: Enquiry): PaymentReadiness {
  const missing: string[] = [];
  if (!stageOk(enquiry, 'paymentTermsSet')) missing.push('Payment Terms');
  return { ready: missing.length === 0, missing };
}
