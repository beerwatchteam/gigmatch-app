import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

// ── Mirrored types ────────────────────────────────────────────────────────────

type FeeType = 'flat' | 'door_split' | 'guarantee_vs_door' | 'ticket_split' | 'unpaid' | 'other';
type PaymentTiming = 'before' | 'after';
type PaymentStatus = 'pending' | 'disputed' | 'confirmed' | 'self_reported' | 'not_applicable';

interface GigFee {
  type: FeeType;
  amountCents?: number | null;
  doorPercent?: number | null;
  includesGst?: boolean | null;
  notes?: string | null;
}

interface PaymentConfirmation {
  amountCents: number;
  at: FirebaseFirestore.Timestamp;
  by: string;
}

interface GigPayment {
  timing: PaymentTiming | null;
  timingProposal: { proposedBy: string; timing: PaymentTiming; proposedAt: FirebaseFirestore.Timestamp } | null;
  status: PaymentStatus;
  venueConfirm: PaymentConfirmation | null;
  artistConfirm: PaymentConfirmation | null;
  confirmedAmountCents: number | null;
  confirmedAt: FirebaseFirestore.Timestamp | null;
  reminderSentAt: FirebaseFirestore.Timestamp | null;
  updatedAt: FirebaseFirestore.Timestamp;
}

interface GigData {
  source: string;
  status: string;
  artistUid: string | null;
  venueUid: string | null;
  enquiryId: string | null;
  participantIds: string[];
  endAt: FirebaseFirestore.Timestamp | null;
  startAt: FirebaseFirestore.Timestamp;
  timezone: string;
  fee: GigFee;
  payment: GigPayment;
  bandName: string;
  artistName: string | null;
  venueName: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mirror of client-side paymentExpectation. */
function expectationMode(fee: GigFee): 'fixed' | 'variable' | 'none' {
  if (fee.type === 'unpaid') return 'none';
  if (fee.type === 'door_split' || fee.type === 'ticket_split') return 'variable';
  if (fee.type === 'guarantee_vs_door') return 'variable';
  if (fee.type === 'flat') return 'fixed';
  // other: fixed if amountCents set
  return fee.amountCents != null ? 'fixed' : 'variable';
}

/** Recomputes payment status from current confirmation state. */
function computeStatus(payment: GigPayment, fee: GigFee, participantIds: string[]): PaymentStatus {
  if (expectationMode(fee) === 'none') return 'not_applicable';
  if (participantIds.length === 1) {
    const hasConfirm = payment.venueConfirm != null || payment.artistConfirm != null;
    return hasConfirm ? 'self_reported' : 'pending';
  }
  if (payment.venueConfirm && payment.artistConfirm) {
    return payment.venueConfirm.amountCents === payment.artistConfirm.amountCents
      ? 'confirmed'
      : 'disputed';
  }
  return 'pending';
}

/**
 * Post a system message to the enquiry thread.
 * Mirrors client postSystemMessage exactly.
 */
async function postSystemMessage(enquiryId: string, text: string): Promise<void> {
  if (!enquiryId) return;
  const db  = getFirestore();
  const now = new Date().toISOString();
  await Promise.all([
    db.collection('messages').add({
      inquiryId: enquiryId,
      sender: '',
      text,
      timestamp: now,
      type: 'system',
    }),
    db.doc(`inquiries/${enquiryId}`).update({ lastMessageAt: now }),
  ]);
}

function formatAud(cents: number): string {
  const dollars = cents / 100;
  const whole   = Math.floor(dollars);
  const rem     = Math.round((dollars - whole) * 100);
  if (rem === 0) return `$${whole}`;
  return `$${whole}.${String(rem).padStart(2, '0')}`;
}

function requireAuth(request: { auth?: { uid: string } | null }): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be signed in.');
  return request.auth.uid;
}

function requireParticipant(uid: string, participantIds: string[]): void {
  if (!participantIds.includes(uid)) {
    throw new HttpsError('permission-denied', 'Not a participant of this gig.');
  }
}

function validateAmountCents(amountCents: unknown): number {
  if (
    typeof amountCents !== 'number' ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0 ||
    amountCents > 10_000_000
  ) {
    throw new HttpsError(
      'invalid-argument',
      'amountCents must be a positive integer not exceeding 10,000,000.',
    );
  }
  return amountCents;
}

// ── confirmPayment ────────────────────────────────────────────────────────────

export const confirmPayment = onCall<{ gigId: string; amountCents: number }>(
  async (request) => {
    const uid = requireAuth(request);
    const { gigId, amountCents } = request.data;
    const validCents = validateAmountCents(amountCents);

    const db     = getFirestore();
    const gigRef = db.doc(`gigs/${gigId}`);

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(gigRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Gig not found.');
      const gig = snap.data() as GigData;

      requireParticipant(uid, gig.participantIds);

      if (gig.status !== 'confirmed') {
        throw new HttpsError('failed-precondition', 'Gig is not confirmed.');
      }
      if (gig.payment.status === 'not_applicable') {
        throw new HttpsError('failed-precondition', 'Payment is not applicable for this gig.');
      }
      if (gig.payment.status === 'confirmed') {
        throw new HttpsError('failed-precondition', 'Payment is already confirmed.');
      }

      // Determine role
      const isTwoParty = gig.participantIds.length > 1;
      const isVenue    = uid === gig.venueUid;
      const isArtist   = uid === gig.artistUid;
      if (!isVenue && !isArtist) {
        throw new HttpsError('permission-denied', 'Only the venue or artist can confirm payment.');
      }

      // Timing gate (two-party gigs only)
      if (isTwoParty && gig.payment.timing === 'after') {
        const endAt = gig.endAt?.toDate();
        if (!endAt || new Date() < endAt) {
          throw new HttpsError('failed-precondition', 'Available after the gig ends.');
        }
      }

      const now = Timestamp.now();
      const confirmation: PaymentConfirmation = { amountCents: validCents, at: now, by: uid };

      // Compute new status
      const merged: GigPayment = {
        ...gig.payment,
        ...(isVenue  ? { venueConfirm:  confirmation } : {}),
        ...(isArtist ? { artistConfirm: confirmation } : {}),
        updatedAt: now,
      };
      const newStatus = computeStatus(merged, gig.fee, gig.participantIds);

      let confirmedAmountCents: number | null = null;
      let confirmedAt: FirebaseFirestore.Timestamp | null = null;

      if (newStatus === 'confirmed' || newStatus === 'self_reported') {
        confirmedAmountCents = validCents;
        const otherAt = isVenue
          ? (gig.payment.artistConfirm?.at ?? now)
          : (gig.payment.venueConfirm?.at  ?? now);
        confirmedAt = now.toDate() >= otherAt.toDate() ? now : otherAt;
      }

      const updateData: Record<string, unknown> = {
        'payment.updatedAt':            now,
        'payment.status':               newStatus,
        'payment.confirmedAmountCents': confirmedAmountCents,
        'payment.confirmedAt':          confirmedAt,
      };
      if (isVenue)  updateData['payment.venueConfirm']  = confirmation;
      if (isArtist) updateData['payment.artistConfirm'] = confirmation;

      tx.update(gigRef, updateData);

      // System messages (best-effort, after transaction)
      const enquiryId = gig.enquiryId ?? '';
      const myName    = isVenue ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist');
      const otherName = isVenue ? (gig.artistName ?? gig.bandName ?? 'Artist') : (gig.venueName ?? 'Venue');
      const verb      = isVenue ? 'paid' : 'received';

      if (newStatus === 'confirmed') {
        postSystemMessage(enquiryId, `Payment confirmed: ${formatAud(validCents)}.`).catch(() => {});
      } else if (newStatus === 'self_reported') {
        postSystemMessage(enquiryId, `${myName} confirmed they've ${verb} ${formatAud(validCents)}.`).catch(() => {});
      } else if (newStatus === 'disputed') {
        const venueCents  = merged.venueConfirm!.amountCents;
        const artistCents = merged.artistConfirm!.amountCents;
        postSystemMessage(
          enquiryId,
          `Payment amounts don't match: ${gig.venueName ?? 'Venue'} ${formatAud(venueCents)}, ` +
          `${gig.artistName ?? gig.bandName ?? 'Artist'} ${formatAud(artistCents)}. ` +
          `Please sort it out in this thread.`,
        ).catch(() => {});
      } else {
        // pending: first confirmation
        const wasNone = !gig.payment.venueConfirm && !gig.payment.artistConfirm;
        if (wasNone) {
          postSystemMessage(
            enquiryId,
            `${myName} confirmed they've ${verb} ${formatAud(validCents)}. Waiting for ${otherName}.`,
          ).catch(() => {});
        }
      }

      return { status: newStatus, confirmedAmountCents };
    });
  },
);

// ── retractPaymentConfirmation ────────────────────────────────────────────────

export const retractPaymentConfirmation = onCall<{ gigId: string }>(
  async (request) => {
    const uid = requireAuth(request);
    const { gigId } = request.data;

    const db     = getFirestore();
    const gigRef = db.doc(`gigs/${gigId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(gigRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Gig not found.');
      const gig = snap.data() as GigData;

      requireParticipant(uid, gig.participantIds);

      if (gig.payment.status === 'confirmed') {
        throw new HttpsError('failed-precondition', 'Cannot retract once payment is confirmed.');
      }

      const isVenue  = uid === gig.venueUid;
      const isArtist = uid === gig.artistUid;
      if (!isVenue && !isArtist) {
        throw new HttpsError('permission-denied', 'Not a venue or artist on this gig.');
      }

      const now    = Timestamp.now();
      const update: Record<string, unknown> = { 'payment.updatedAt': now };
      if (isVenue)  update['payment.venueConfirm']  = null;
      if (isArtist) update['payment.artistConfirm'] = null;

      // Re-compute with the confirmation removed
      const merged: GigPayment = {
        ...gig.payment,
        venueConfirm:  isVenue  ? null : gig.payment.venueConfirm,
        artistConfirm: isArtist ? null : gig.payment.artistConfirm,
      };
      const newStatus = computeStatus(merged, gig.fee, gig.participantIds);
      update['payment.status']               = newStatus;
      update['payment.confirmedAmountCents'] = null;
      update['payment.confirmedAt']          = null;

      tx.update(gigRef, update);

      const enquiryId = gig.enquiryId ?? '';
      const myName    = isVenue ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist');
      postSystemMessage(enquiryId, `${myName} withdrew their payment confirmation.`).catch(() => {});
    });
  },
);

// ── proposePaymentTiming ──────────────────────────────────────────────────────

export const proposePaymentTiming = onCall<{ gigId: string; timing: PaymentTiming }>(
  async (request) => {
    const uid = requireAuth(request);
    const { gigId, timing } = request.data;

    if (timing !== 'before' && timing !== 'after') {
      throw new HttpsError('invalid-argument', 'timing must be "before" or "after".');
    }

    const db     = getFirestore();
    const gigRef = db.doc(`gigs/${gigId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(gigRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Gig not found.');
      const gig = snap.data() as GigData;

      requireParticipant(uid, gig.participantIds);

      if (gig.source !== 'enquiry') {
        throw new HttpsError('failed-precondition', 'Timing proposals are only for Twaylo bookings.');
      }
      if (gig.payment.venueConfirm || gig.payment.artistConfirm) {
        throw new HttpsError('failed-precondition', 'Cannot change timing once a confirmation exists.');
      }
      if (gig.payment.timing === timing) {
        throw new HttpsError('invalid-argument', 'That is already the current timing.');
      }

      const now = Timestamp.now();
      tx.update(gigRef, {
        'payment.timingProposal': { proposedBy: uid, timing, proposedAt: now },
        'payment.updatedAt':      now,
      });

      const isVenue  = uid === gig.venueUid;
      const myName   = isVenue ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist');
      const enquiryId = gig.enquiryId ?? '';
      postSystemMessage(enquiryId, `${myName} proposed paying ${timing} the gig.`).catch(() => {});
    });
  },
);

// ── respondPaymentTiming ──────────────────────────────────────────────────────

export const respondPaymentTiming = onCall<{ gigId: string; accept: boolean }>(
  async (request) => {
    const uid = requireAuth(request);
    const { gigId, accept } = request.data;

    const db     = getFirestore();
    const gigRef = db.doc(`gigs/${gigId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(gigRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Gig not found.');
      const gig = snap.data() as GigData;

      requireParticipant(uid, gig.participantIds);

      const proposal = gig.payment.timingProposal;
      if (!proposal) throw new HttpsError('failed-precondition', 'No timing proposal to respond to.');
      if (proposal.proposedBy === uid) {
        throw new HttpsError('permission-denied', 'Only the other party can respond to this proposal.');
      }

      const now      = Timestamp.now();
      const enquiryId = gig.enquiryId ?? '';
      const isVenue  = uid === gig.venueUid;
      const myName   = isVenue ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist');

      if (accept) {
        tx.update(gigRef, {
          'payment.timing':          proposal.timing,
          'payment.timingProposal':  null,
          'payment.updatedAt':       now,
        });
        postSystemMessage(enquiryId, `Payment timing set to ${proposal.timing} the gig.`).catch(() => {});
      } else {
        tx.update(gigRef, {
          'payment.timingProposal': null,
          'payment.updatedAt':      now,
        });
        postSystemMessage(enquiryId, `${myName} declined the timing change.`).catch(() => {});
      }
    });
  },
);

// ── updateGigFee ──────────────────────────────────────────────────────────────

export const updateGigFee = onCall<{ gigId: string; fee: GigFee }>(
  async (request) => {
    const uid = requireAuth(request);
    const { gigId, fee } = request.data;

    // Basic fee validation (mirrors validateFee in gig-types.ts)
    if (!fee || typeof fee.type !== 'string') {
      throw new HttpsError('invalid-argument', 'Invalid fee object.');
    }
    if ((fee.type === 'flat' || fee.type === 'guarantee_vs_door' || fee.type === 'ticket_split')) {
      if (fee.amountCents == null || fee.amountCents < 0) {
        throw new HttpsError('invalid-argument', 'A fee amount is required for this fee type.');
      }
    }
    if (fee.type === 'door_split') {
      if (fee.doorPercent == null || fee.doorPercent < 0 || fee.doorPercent > 100) {
        throw new HttpsError('invalid-argument', 'A valid door split percentage (0-100) is required.');
      }
    }

    const db     = getFirestore();
    const gigRef = db.doc(`gigs/${gigId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(gigRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Gig not found.');
      const gig = snap.data() as GigData;

      requireParticipant(uid, gig.participantIds);

      if (gig.source !== 'enquiry') {
        throw new HttpsError('failed-precondition', 'Use updateGigFee only for Twaylo bookings. Edit directly for other gig types.');
      }
      if (gig.status !== 'confirmed') {
        throw new HttpsError('failed-precondition', 'Gig is not confirmed.');
      }
      if (gig.payment.status === 'confirmed') {
        throw new HttpsError('failed-precondition', 'Payment is already confirmed; fee cannot be changed.');
      }

      // No-op check: compare relevant fields
      const same =
        gig.fee.type           === fee.type &&
        gig.fee.amountCents    === (fee.amountCents    ?? null) &&
        gig.fee.doorPercent    === (fee.doorPercent    ?? null) &&
        gig.fee.includesGst    === (fee.includesGst    ?? null) &&
        gig.fee.notes          === (fee.notes          ?? null);
      if (same) return; // no write

      const now       = Timestamp.now();
      const newStatus = computeStatus(
        { ...gig.payment, venueConfirm: null, artistConfirm: null, timingProposal: null },
        fee,
        gig.participantIds,
      );

      tx.update(gigRef, {
        fee,
        'payment.venueConfirm':         null,
        'payment.artistConfirm':        null,
        'payment.timingProposal':       null,
        'payment.confirmedAmountCents': null,
        'payment.confirmedAt':          null,
        'payment.status':               newStatus,
        'payment.updatedAt':            now,
        updatedAt:                      now,
      });

      // System message
      const enquiryId = gig.enquiryId ?? '';
      if (enquiryId) {
        const isVenue  = uid === gig.venueUid;
        const myName   = isVenue ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist');
        const oldCents = gig.fee.amountCents;
        const newCents = fee.amountCents ?? null;
        if (oldCents != null && newCents != null && oldCents !== newCents) {
          postSystemMessage(
            enquiryId,
            `${myName} updated the agreed fee from ${formatAud(oldCents)} to ${formatAud(newCents)}.`,
          ).catch(() => {});
        } else {
          postSystemMessage(enquiryId, `${myName} updated the fee details.`).catch(() => {});
        }
      }
    });
  },
);

// ── resetSinglePartyPayment ───────────────────────────────────────────────────
// Called by the client when switching a non-enquiry gig to/from unpaid,
// because the rules only allow fresh payment state on create.

export const resetSinglePartyPayment = onCall<{ gigId: string; fee: GigFee }>(
  async (request) => {
    const uid = requireAuth(request);
    const { gigId, fee } = request.data;

    const db     = getFirestore();
    const gigRef = db.doc(`gigs/${gigId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(gigRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Gig not found.');
      const gig = snap.data() as GigData;

      requireParticipant(uid, gig.participantIds);

      if (gig.source === 'enquiry') {
        throw new HttpsError('failed-precondition', 'Use updateGigFee for Twaylo bookings.');
      }
      if (gig.participantIds.length > 1) {
        throw new HttpsError('failed-precondition', 'Use updateGigFee for two-party gigs.');
      }

      const now       = Timestamp.now();
      const newStatus = fee.type === 'unpaid' ? 'not_applicable' : 'pending';

      tx.update(gigRef, {
        fee,
        'payment.status':               newStatus,
        'payment.venueConfirm':         null,
        'payment.artistConfirm':        null,
        'payment.timingProposal':       null,
        'payment.confirmedAmountCents': null,
        'payment.confirmedAt':          null,
        'payment.timing':               null,
        'payment.updatedAt':            now,
        updatedAt:                      now,
      });
    });
  },
);

// ── sendPaymentReminders ──────────────────────────────────────────────────────

export const sendPaymentReminders = onSchedule('every 60 minutes', async () => {
  const db  = getFirestore();
  const now = new Date();

  // Query gigs that have ended and have a pending payment with no reminder yet
  const snap = await db.collection('gigs')
    .where('payment.status', '==', 'pending')
    .where('payment.reminderSentAt', '==', null)
    .where('endAt', '<=', Timestamp.fromDate(now))
    .limit(100)
    .get();

  for (const doc of snap.docs) {
    const gig = doc.data() as GigData;

    // Only enquiry gigs with timing 'after'
    if (gig.source !== 'enquiry') continue;
    if (gig.status !== 'confirmed') continue;
    if (gig.payment.timing !== 'after') continue;
    if (!gig.enquiryId) continue;

    const endAt   = gig.endAt!.toDate();
    const tz      = gig.timezone ?? 'Australia/Melbourne';
    const endLocal = toZonedTime(endAt, tz);

    // Due time: max(endAt + 1h, 09:00 local on day + 1)
    const endPlusOneHour = new Date(endAt.getTime() + 60 * 60_000);
    const nextDay9am = fromZonedTime(
      new Date(endLocal.getFullYear(), endLocal.getMonth(), endLocal.getDate() + 1, 9, 0, 0),
      tz,
    );
    const dueTime = endPlusOneHour > nextDay9am ? endPlusOneHour : nextDay9am;

    if (now < dueTime) continue;

    try {
      await postSystemMessage(
        gig.enquiryId,
        'Reminder: payment for this gig is due. Confirm once it\'s been paid or received.',
      );
      await doc.ref.update({ 'payment.reminderSentAt': Timestamp.now() });
      // TODO(email): send email notification to both parties
    } catch (err) {
      console.error(`[sendPaymentReminders] failed for gig ${doc.id}:`, err);
    }
  }
});
