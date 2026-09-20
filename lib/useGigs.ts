import {
  doc, runTransaction, Timestamp, collection,
} from 'firebase/firestore';
import { db } from './firebase';
import { type Enquiry, sendMessage, postSystemMessage, confirmHeadliner } from './useEnquiries';
import { type GigFee, type GigSource, type Gig, toStartAt } from './gig-types';

// ── SlotConflictError ────────────────────────────────────────────────────────

export class SlotConflictError extends Error {
  constructor() {
    super('This slot is already reserved for another act.');
    this.name = 'SlotConflictError';
  }
}

// ── Slot helpers ─────────────────────────────────────────────────────────────

const normSlot = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

/**
 * Pure function: given the existing slots map and enquiry details,
 * returns a new slots map with the matching slot set to `status`.
 * Throws SlotConflictError if the slot is already booked by a different band.
 */
export function applySlotBooking(
  slots: Record<string, any[]>,
  enquiry: Enquiry,
  status: 'booked' | 'pending',
): Record<string, any[]> {
  const { day, date, time, room } = enquiry.requestedSlot;
  if (!day || !time) return slots;

  const result = { ...slots };
  const daySlots = [...(result[day] || [])];
  const slotDate = date ?? null;

  const existingIdx = daySlots.findIndex(s =>
    s.date === slotDate &&
    normSlot(s.time) === normSlot(time) &&
    (!room || normSlot(s.room ?? '') === normSlot(room))
  );

  if (existingIdx >= 0) {
    const existing = daySlots[existingIdx];
    if (
      (existing.status === 'booked' || existing.status === 'pending') &&
      existing.bandName &&
      existing.bandName !== enquiry.bandName
    ) {
      throw new SlotConflictError();
    }
    daySlots[existingIdx] = { ...existing, status, bandName: enquiry.bandName };
  } else {
    const openSlot = daySlots.find(
      s => !s.date && s.status === 'open' && normSlot(s.time) === normSlot(time)
    );
    daySlots.push({
      ...(openSlot ? { ...openSlot } : {}),
      id: `${day.toLowerCase()}-${slotDate}-${normSlot(time)}`,
      time,
      date: slotDate,
      status,
      bandName: enquiry.bandName,
      room: room ?? null,
    });
  }

  result[day] = daySlots;
  return result;
}

// ── confirmGigFromEnquiry ────────────────────────────────────────────────────

export type ConfirmGigParams = {
  enquiry: Enquiry;
  venueOwnerUid: string;
  venueDisplayName: string;
  venuePhotoUrl: string | null;
  localDate: string;           // YYYY-MM-DD
  localTime: string;           // HH:MM
  timezone: string;            // IANA
  fee: GigFee;
  setLengthMinutes: number;
  loadInTime?: string;
  soundCheckTime?: string;
  notes?: string;
  listAsBooked: boolean;
  confirmMessage?: string;
};

/**
 * Atomically:
 * 1. Creates a gig doc
 * 2. Updates the venue slot (booked or pending)
 * 3. Sets enquiry.status = 'confirmed' and enquiry.gigId = gig.id
 *
 * All reads come before all writes (Firestore transaction requirement).
 * Throws SlotConflictError if the slot is taken by a different act.
 * Throws a FirestoreError with code 'unavailable' when offline.
 *
 * After the transaction, confirmHeadliner and postSystemMessage are called
 * best-effort (they do NOT roll back on failure).
 */
export async function confirmGigFromEnquiry(params: ConfirmGigParams): Promise<string> {
  const {
    enquiry, venueOwnerUid, venueDisplayName, venuePhotoUrl,
    localDate, localTime, timezone,
    fee, setLengthMinutes, loadInTime, soundCheckTime,
    notes, listAsBooked, confirmMessage,
  } = params;

  const gigRef     = doc(collection(db, 'gigs'));
  const venueRef   = doc(db, 'venues', enquiry.venueId);
  const enquiryRef = doc(db, 'inquiries', enquiry.id);
  const gigId      = gigRef.id;

  await runTransaction(db, async (tx) => {
    // ── READS first ──────────────────────────────────────────────────
    const venueSnap = await tx.get(venueRef);
    if (!venueSnap.exists()) throw new Error('Venue not found');

    const slots: Record<string, any[]> = { ...(venueSnap.data().slots || {}) };

    // Throws SlotConflictError if taken by another band
    const newSlots = applySlotBooking(slots, enquiry, listAsBooked ? 'booked' : 'pending');

    const startAt = toStartAt(localDate, localTime, timezone);
    const now     = Timestamp.now();

    const participantIds = Array.from(new Set([enquiry.createdBy, venueOwnerUid].filter(Boolean)));

    const gigData: Omit<Gig, 'id'> = {
      enquiryId: enquiry.id,
      venueId:   enquiry.venueId,
      venueName: enquiry.venueName,
      artistUid: enquiry.createdBy,
      bandName:  enquiry.bandName,
      status:    'confirmed',
      source:    'enquiry' as GigSource,
      startAt,
      timezone,
      setLengthMinutes,
      ...(loadInTime   ? { loadInTime }   : {}),
      ...(soundCheckTime ? { soundCheckTime } : {}),
      ...(enquiry.requestedSlot.room ? { room: enquiry.requestedSlot.room } : {}),
      fee,
      participantIds,
      ...(notes ? { notes } : {}),
      listAsBooked,
      createdAt: now,
      updatedAt: now,
    };

    // ── WRITES last ──────────────────────────────────────────────────
    tx.set(gigRef, gigData);
    tx.update(venueRef, { slots: newSlots });
    tx.update(enquiryRef, { status: 'confirmed', gigId, listAsBooked, feeType: fee.type, fee });
  });

  // Best-effort post-transaction side effects
  const sysMsg = formatGigConfirmedMessage(
    enquiry.bandName, enquiry.venueName, localDate, localTime,
  );
  await postSystemMessage(enquiry.id, sysMsg).catch(() => {});

  if (confirmMessage?.trim()) {
    await sendMessage(enquiry.id, venueOwnerUid, confirmMessage.trim()).catch(() => {});
  }

  await confirmHeadliner(
    enquiry.id,
    enquiry.createdBy,
    venueOwnerUid,
    venueDisplayName,
    venuePhotoUrl,
  ).catch(() => {});

  return gigId;
}

// ── cancelAcceptance ─────────────────────────────────────────────────────────

/**
 * Transactionally:
 * 1. Removes the slot override from the venue timetable
 * 2. Sets enquiry status back to 'discussing'
 * 3. Sets the gig doc to 'cancelled' (if gigId present)
 *
 * Safe to call on legacy enquiries that have no gigId.
 */
export async function cancelAcceptance(enquiry: Enquiry, _actingUid: string): Promise<void> {
  const venueRef   = doc(db, 'venues', enquiry.venueId);
  const enquiryRef = doc(db, 'inquiries', enquiry.id);
  const gigId      = (enquiry as any).gigId as string | undefined;

  await runTransaction(db, async (tx) => {
    // ── READS first ──────────────────────────────────────────────────
    const venueSnap = await tx.get(venueRef);
    const gigSnap   = gigId ? await tx.get(doc(db, 'gigs', gigId)) : null;

    let newSlots: Record<string, any[]> | null = null;
    if (venueSnap.exists()) {
      const { day, date, time, room } = enquiry.requestedSlot;
      if (day && time) {
        const slots: Record<string, any[]> = { ...(venueSnap.data().slots || {}) };
        const slotDate = date ?? null;
        slots[day] = (slots[day] || []).filter(s =>
          !(s.date === slotDate &&
            normSlot(s.time) === normSlot(time) &&
            (!room || normSlot(s.room ?? '') === normSlot(room)))
        );
        newSlots = slots;
      }
    }

    // ── WRITES last ──────────────────────────────────────────────────
    if (newSlots && venueSnap.exists()) {
      tx.update(venueRef, { slots: newSlots });
    }
    tx.update(enquiryRef, { status: 'discussing', listAsBooked: false });
    if (gigId && gigSnap?.exists()) {
      tx.update(doc(db, 'gigs', gigId), { status: 'cancelled', updatedAt: Timestamp.now() });
    }
  });
}

// ── upgradeGigToBooked ───────────────────────────────────────────────────────

/**
 * Upgrades an already-confirmed gig from pending to publicly listed (booked).
 * Atomically updates the enquiry, the gig doc (if present), and the venue timetable slot.
 * Called when the venue presses "List as Booked" after the initial confirm-as-pending flow.
 */
export async function upgradeGigToBooked(
  enquiry: Enquiry,
  fee: import('./gig-types').GigFee,
): Promise<void> {
  const enquiryRef = doc(db, 'inquiries', enquiry.id);
  const venueRef   = doc(db, 'venues', enquiry.venueId);
  const gigId      = (enquiry as any).gigId as string | undefined;

  await runTransaction(db, async (tx) => {
    const venueSnap = await tx.get(venueRef);
    if (gigId) await tx.get(doc(db, 'gigs', gigId)); // read before writes

    let newSlots: Record<string, any[]> | null = null;
    if (venueSnap.exists()) {
      try {
        newSlots = applySlotBooking({ ...(venueSnap.data().slots || {}) }, enquiry, 'booked');
      } catch { /* slot conflict — ignore, already booked */ }
    }

    tx.update(enquiryRef, { listAsBooked: true, feeType: fee.type, fee });
    if (newSlots && venueSnap.exists()) tx.update(venueRef, { slots: newSlots });
    if (gigId) {
      tx.update(doc(db, 'gigs', gigId), { fee, listAsBooked: true, updatedAt: Timestamp.now() });
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatGigConfirmedMessage(
  bandName: string,
  venueName: string,
  localDate: string,
  localTime: string,
): string {
  return `Gig confirmed: ${bandName} at ${venueName} on ${localDate} at ${localTime}`;
}
