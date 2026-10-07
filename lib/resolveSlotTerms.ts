// ── resolveSlotTerms ─────────────────────────────────────────────────────────
//
// Merges a gig slot's own pay/hospitality settings with the venue's booking
// term defaults, respecting the slot's `useDefaultPay` and
// `useDefaultHospitality` flags.
//
// Import this in both the venue profile (read-only display) and anywhere else
// pay terms need to be formatted consistently.

export type BookingTerms = {
  payModels: string[];
  negotiable: boolean;
  flatFeeMin: string;
  flatFeeMax: string;
  flatFeeBasis: string;
  doorSplit: string;
  guaranteeAmount: string;
  guaranteeSplit: string;
  barSplit: string;
  ticketSplitPct: string;
  ticketingBy: string;
  methods: string[];
  paymentTiming: string;
  depositRequired: boolean;
  depositAmount: string;
  depositDue: string;
  minNotice: string;
  guestList: string;
  meals: boolean;
  mealsDetails: string;
  drinks: boolean;
  drinksDetails: string;
  reqAbn: boolean;
  showPayPublicly: boolean;
};

export type ResolvedTerms = BookingTerms & {
  invoicingMode: string;
};

const BLANK: BookingTerms = {
  payModels: [], negotiable: true,
  flatFeeMin: '', flatFeeMax: '', flatFeeBasis: 'Per act',
  doorSplit: '', guaranteeAmount: '', guaranteeSplit: '',
  barSplit: '', ticketSplitPct: '', ticketingBy: 'Venue',
  methods: [], paymentTiming: '',
  depositRequired: false, depositAmount: '', depositDue: '',
  minNotice: '1 week',
  guestList: '', meals: false, mealsDetails: '', drinks: false, drinksDetails: '',
  reqAbn: false,
  showPayPublicly: false,
};

/**
 * Returns unified terms for a slot, falling back to venue defaults where the
 * slot defers to them.
 *
 * @param venue  The full venue document (any shape — only the fields we need
 *               are read, missing fields fall back to BLANK).
 * @param slot   A single slot/gigNight object. May be undefined when called
 *               for venue-level display (returns venue defaults).
 */
export function resolveSlotTerms(venue: any, slot?: any): ResolvedTerms {
  const vbt: BookingTerms = { ...BLANK, ...(venue?.bookingTerms ?? {}) };
  const invoicingMode: string = venue?.invoicingMode ?? 'actsInvoice';

  if (!slot) {
    return { ...vbt, invoicingMode };
  }

  // ── Pay ──────────────────────────────────────────────────────────────────
  const useDefaultPay = slot.useDefaultPay !== false;
  let payModels: string[];
  let flatFeeMin: string;
  let flatFeeMax: string;
  let flatFeeBasis: string;
  let doorSplit: string;
  let guaranteeAmount: string;
  let guaranteeSplit: string;
  let barSplit: string;
  let ticketSplitPct: string;
  let ticketingBy: string;
  let negotiable: boolean;

  if (useDefaultPay) {
    ({ payModels, flatFeeMin, flatFeeMax, flatFeeBasis,
       doorSplit, guaranteeAmount, guaranteeSplit,
       barSplit, ticketSplitPct, ticketingBy, negotiable } = vbt);
  } else {
    // Slot stores models as paymentModels array (or legacy paymentModel string)
    payModels = slot.paymentModels?.length
      ? slot.paymentModels
      : slot.paymentModel ? [slot.paymentModel] : [];
    // Slot stores fees as numbers or strings
    flatFeeMin = slot.feeMin != null ? String(slot.feeMin) : '';
    flatFeeMax = slot.feeMax != null ? String(slot.feeMax) : '';
    flatFeeBasis = slot.feeBasis || 'Per act';
    doorSplit = slot.doorSplit || '';
    guaranteeAmount = slot.guaranteeAmount || '';
    guaranteeSplit = slot.guaranteeSplit || '';
    barSplit = slot.barSplit || '';
    ticketSplitPct = slot.ticketSalesSplit || '';
    ticketingBy = slot.ticketingHandledBy || 'Venue';
    negotiable = slot.negotiable !== false;
  }

  // ── Hospitality ──────────────────────────────────────────────────────────
  const useDefaultHosp = slot.useDefaultHospitality !== false;
  let guestList: string;
  let meals: boolean;
  let mealsDetails: string;
  let drinks: boolean;
  let drinksDetails: string;

  if (useDefaultHosp) {
    ({ guestList, meals, mealsDetails, drinks, drinksDetails } = vbt);
  } else {
    guestList = slot.guestList || '';
    meals = slot.meals || false;
    mealsDetails = slot.mealsDetails || '';
    drinks = slot.drinks || false;
    drinksDetails = slot.drinksDetails || '';
  }

  // ── Booking rules ────────────────────────────────────────────────────────
  // Slot-level minNotice overrides venue default when set
  const minNotice = slot.minNotice || vbt.minNotice || '1 week';

  // Payment method comes from venue booking terms (no slot-level override)
  const methods = vbt.methods;
  const paymentTiming = vbt.paymentTiming;
  const depositRequired = vbt.depositRequired;
  const depositAmount = vbt.depositAmount;
  const depositDue = vbt.depositDue;
  const reqAbn = vbt.reqAbn;
  const showPayPublicly = vbt.showPayPublicly;

  return {
    payModels, negotiable,
    flatFeeMin, flatFeeMax, flatFeeBasis,
    doorSplit, guaranteeAmount, guaranteeSplit,
    barSplit, ticketSplitPct, ticketingBy,
    methods, paymentTiming,
    depositRequired, depositAmount, depositDue,
    minNotice,
    guestList, meals, mealsDetails, drinks, drinksDetails,
    reqAbn, showPayPublicly,
    invoicingMode,
  };
}

/**
 * Formats resolved pay terms into a compact summary string.
 * Used by date rows, regular-night cards, and the key facts strip.
 *
 * Examples:
 *   "$300-$500 flat fee"
 *   "$200 guarantee + split"
 *   "Ticket split"
 *   "Flat fee, or door split"
 *   "Unpaid · 1 drink ticket"     (when drinks perk exists)
 */
export function formatPaySummary(terms: Pick<ResolvedTerms, 'payModels' | 'flatFeeMin' | 'flatFeeMax' | 'guaranteeAmount' | 'drinks' | 'drinksDetails'>): string {
  const models = terms.payModels ?? [];
  if (models.length === 0) return '';

  const parts: string[] = [];

  for (const model of models) {
    if (model === 'Flat fee') {
      const min = parseFloat(terms.flatFeeMin);
      const max = parseFloat(terms.flatFeeMax);
      if (!isNaN(min) && !isNaN(max) && max > min) {
        parts.push(`$${min}\u2013$${max} flat fee`);
      } else if (!isNaN(min)) {
        parts.push(`$${min} flat fee`);
      } else {
        parts.push('Flat fee');
      }
    } else if (model === 'Guarantee + split') {
      const g = parseFloat(terms.guaranteeAmount);
      parts.push(!isNaN(g) ? `$${g} guarantee + split` : 'Guarantee + split');
    } else if (model === 'Ticket split') {
      parts.push('Ticket split');
    } else if (model === 'Door split') {
      parts.push('Door split');
    } else if (model === 'Bar split') {
      parts.push('Bar split');
    } else if (model === 'Unpaid') {
      const perk = terms.drinks && terms.drinksDetails ? terms.drinksDetails : terms.drinks ? 'drinks' : null;
      parts.push(perk ? `Unpaid \u00b7 ${perk}` : 'Unpaid');
    } else {
      parts.push(model);
    }
  }

  return parts.join(', or ');
}
