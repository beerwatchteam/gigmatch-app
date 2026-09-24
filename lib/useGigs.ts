import {
  doc, runTransaction, Timestamp, collection, writeBatch, setDoc,
  updateDoc, getDocs, query, where,
} from 'firebase/firestore';
import { ref as sRef, deleteObject, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase';
import { type Enquiry, sendMessage, postSystemMessage, confirmHeadliner } from './useEnquiries';
import {
  type GigFee, type GigSource, type GigStatus, type Gig,
  type GigPrivateDoc, type GigDocKind, type GigPayment, type PaymentTiming,
  toStartAt, STATE_TZ,
} from './gig-types';

// ── SlotConflictError ────────────────────────────────────────────────────────

export class SlotConflictError extends Error {
  constructor() {
    super('This slot is already reserved for another act.');
    this.name = 'SlotConflictError';
  }
}

// ── Slot helpers ─────────────────────────────────────────────────────────────

const normSlot = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

export type SlotKey = {
  day: string;
  date: string | null;
  time: string;
  room?: string | null;
};

export type SlotOverrideData = {
  gigId?: string;
  actName?: string | null;
  gigName?: string | null;
  ticketUrl?: string | null;
  ticketPriceCents?: number | null;
  description?: string | null;
};

/**
 * Pure function: applies a slot booking override to the slots map.
 *
 * Conflict rule: throws SlotConflictError if a booked/pending override with a
 * DIFFERENT gigId already exists at the same date, time and room.
 * Overrides with no gigId (legacy) are treated as non-conflicting.
 *
 * If no template slot matches (one-off time), creates a new date-specific override.
 */
export function applySlotBooking(
  slots: Record<string, any[]>,
  key: SlotKey,
  status: 'booked' | 'pending',
  override?: SlotOverrideData,
): Record<string, any[]> {
  const { day, date, time, room } = key;
  if (!day || !time) return slots;

  const result   = { ...slots };
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
      existing.gigId != null &&
      override?.gigId != null &&
      existing.gigId !== override.gigId
    ) {
      throw new SlotConflictError();
    }
    daySlots[existingIdx] = {
      ...existing,
      status,
      bandName: override?.actName ?? existing.bandName ?? null,
      ...(override?.gigId            != null ? { gigId:           override.gigId            } : {}),
      ...(override?.actName          != null ? { actName:         override.actName          } : {}),
      ...(override?.gigName          != null ? { gigName:         override.gigName          } : {}),
      ...(override?.ticketUrl        != null ? { ticketUrl:       override.ticketUrl        } : {}),
      ...(override?.ticketPriceCents != null ? { ticketPriceCents: override.ticketPriceCents } : {}),
      ...(override?.description      != null ? { description:     override.description      } : {}),
    };
  } else {
    // Inherit slot metadata from a matching recurring open template
    const template = daySlots.find(
      s => !s.date && s.status === 'open' && normSlot(s.time) === normSlot(time)
    );
    daySlots.push({
      ...(template ? { ...template } : {}),
      id: `${day.toLowerCase()}-${slotDate}-${normSlot(time)}${room ? '-' + normSlot(room) : ''}`,
      day,
      time,
      date: slotDate,
      status,
      room: room ?? null,
      bandName: override?.actName ?? null,
      ...(override?.gigId            != null ? { gigId:           override.gigId            } : {}),
      ...(override?.actName          != null ? { actName:         override.actName          } : {}),
      ...(override?.gigName          != null ? { gigName:         override.gigName          } : {}),
      ...(override?.ticketUrl        != null ? { ticketUrl:       override.ticketUrl        } : {}),
      ...(override?.ticketPriceCents != null ? { ticketPriceCents: override.ticketPriceCents } : {}),
      ...(override?.description      != null ? { description:     override.description      } : {}),
    });
  }

  result[day] = daySlots;
  return result;
}

/** Remove the date-specific override that has the given gigId across all days. */
export function removeSlotBooking(
  slots: Record<string, any[]>,
  gigId: string,
): Record<string, any[]> {
  const result = { ...slots };
  for (const day of Object.keys(result)) {
    result[day] = result[day].filter((s: any) => s.gigId !== gigId);
  }
  return result;
}

/** Update publicDetails on an existing override by gigId. */
export function updateOverrideDetails(
  slots: Record<string, any[]>,
  gigId: string,
  details: SlotOverrideData,
): Record<string, any[]> {
  const result = { ...slots };
  for (const day of Object.keys(result)) {
    result[day] = result[day].map((s: any) =>
      s.gigId === gigId
        ? {
            ...s,
            ...(details.gigName            != null ? { gigName:          details.gigName            } : {}),
            ...(details.actName            != null ? { actName:          details.actName, bandName: details.actName } : {}),
            ...(details.ticketUrl          != null ? { ticketUrl:        details.ticketUrl          } : {}),
            ...(details.ticketPriceCents   != null ? { ticketPriceCents: details.ticketPriceCents   } : {}),
            ...(details.description        != null ? { description:      details.description        } : {}),
          }
        : s
    );
  }
  return result;
}

// ── Payment helpers ──────────────────────────────────────────────────────────

/**
 * Builds a fresh payment map for gig creation.
 * status: 'not_applicable' for unpaid gigs, 'pending' otherwise.
 */
export function buildFreshPayment(feeType: GigFee['type'], timing: PaymentTiming | null): GigPayment {
  return {
    timing,
    timingProposal:       null,
    status:               feeType === 'unpaid' ? 'not_applicable' : 'pending',
    venueConfirm:         null,
    artistConfirm:        null,
    confirmedAmountCents: null,
    confirmedAt:          null,
    reminderSentAt:       null,
    updatedAt:            Timestamp.now(),
  };
}

// ── confirmGigFromEnquiry ────────────────────────────────────────────────────

export type ConfirmGigParams = {
  enquiry: Enquiry;
  venueOwnerUid: string;
  venueDisplayName: string;
  venuePhotoUrl: string | null;
  localDate: string;         // YYYY-MM-DD
  localTime: string;         // HH:MM
  localEndTime?: string;     // HH:MM (optional; defaults to localTime + setLengthMinutes)
  timezone: string;          // IANA
  fee: GigFee;
  paymentTiming?: PaymentTiming;
  setLengthMinutes: number;
  loadInTime?: string;
  soundCheckTime?: string;
  listAsBooked: boolean;
  confirmMessage?: string;
};

/**
 * Atomically:
 * 1. Creates (or re-activates) a gig doc
 * 2. Updates the venue slot override
 * 3. Sets enquiry.status = 'confirmed' and enquiry.gigId = gigId
 *
 * Re-accept: if enquiry.gigId already exists (previously cancelled), updates
 * that doc instead of creating a new one, and preserves the artist's isPublic
 * choice.
 *
 * Throws SlotConflictError if the slot is already taken by a different act.
 * Throws a FirestoreError with code 'unavailable' when offline.
 */
export async function confirmGigFromEnquiry(params: ConfirmGigParams): Promise<string> {
  const {
    enquiry, venueOwnerUid,
    localDate, localTime, localEndTime,
    timezone, fee, paymentTiming = 'after', setLengthMinutes,
    loadInTime, soundCheckTime,
    listAsBooked, confirmMessage,
    venueDisplayName, venuePhotoUrl,
  } = params;

  const existingGigId = (enquiry as any).gigId as string | undefined;
  const gigRef     = existingGigId
    ? doc(db, 'gigs', existingGigId)
    : doc(collection(db, 'gigs'));
  const venueRef   = doc(db, 'venues', enquiry.venueId);
  const enquiryRef = doc(db, 'inquiries', enquiry.id);
  const gigId      = gigRef.id;

  const startAt = toStartAt(localDate, localTime, timezone);
  const rawEndAt = localEndTime
    ? toStartAt(localDate, localEndTime, timezone)
    : Timestamp.fromDate(new Date(startAt.toDate().getTime() + setLengthMinutes * 60_000));
  const endAt = rawEndAt.toDate() <= startAt.toDate()
    ? Timestamp.fromDate(new Date(rawEndAt.toDate().getTime() + 24 * 3600_000))
    : rawEndAt;

  const slotKey: SlotKey = {
    day:  enquiry.requestedSlot.day,
    date: localDate,
    time: localTime,
    room: enquiry.requestedSlot.room ?? null,
  };

  await runTransaction(db, async (tx) => {
    // ── READS first ──────────────────────────────────────────────────
    const venueSnap = await tx.get(venueRef);
    if (!venueSnap.exists()) throw new Error('Venue not found');

    let existingIsPublic = true; // default on first confirm
    let existingGigData: Record<string, any> | null = null;
    if (existingGigId) {
      const existingGigSnap = await tx.get(gigRef);
      if (existingGigSnap.exists()) {
        existingGigData = existingGigSnap.data() as Record<string, any>;
        existingIsPublic = existingGigData?.isPublic ?? true;
      }
    }

    const slots: Record<string, any[]> = { ...(venueSnap.data().slots || {}) };
    const newSlots = applySlotBooking(slots, slotKey, listAsBooked ? 'booked' : 'pending', {
      gigId,
      actName: enquiry.bandName,
      gigName: null,
    });

    const now          = Timestamp.now();
    const participantIds = Array.from(
      new Set([enquiry.createdBy, venueOwnerUid].filter(Boolean))
    );

    // On re-accept of a cancelled gig, keep existing payment if already confirmed.
    let paymentForGig: GigPayment;
    if (existingGigData) {
      const existingPayment = existingGigData.payment as GigPayment | undefined;
      if (existingPayment?.status === 'confirmed') {
        paymentForGig = existingPayment;
      } else {
        paymentForGig = buildFreshPayment(fee.type, paymentTiming);
      }
    } else {
      paymentForGig = buildFreshPayment(fee.type, paymentTiming);
    }

    const gigData = {
      enquiryId:        enquiry.id,
      venueId:          enquiry.venueId,
      venueName:        enquiry.venueName,
      venueUid:         venueOwnerUid,
      artistUid:        enquiry.createdBy,
      artistName:       enquiry.bandName,
      bandName:         enquiry.bandName,
      title:            null,
      description:      null,
      locationText:     null,
      state:            null,
      isPublic:         existingIsPublic,
      status:           'confirmed' as GigStatus,
      source:           'enquiry' as GigSource,
      startAt,
      endAt,
      timezone,
      setLengthMinutes: setLengthMinutes ?? null,
      loadInTime:       loadInTime ?? null,
      soundCheckTime:   soundCheckTime ?? null,
      room:             enquiry.requestedSlot.room ?? null,
      fee,
      payment:          paymentForGig,
      participantIds,
      createdBy:        venueOwnerUid,
      listAsBooked,
      updatedAt:        now,
    };

    // ── WRITES last ──────────────────────────────────────────────────
    if (existingGigId) {
      tx.update(gigRef, gigData);
    } else {
      tx.set(gigRef, { ...gigData, createdAt: now });
    }
    tx.update(venueRef, { slots: newSlots });
    tx.update(enquiryRef, {
      status: 'confirmed', gigId, listAsBooked,
      feeType: fee.type, fee, timezone,
      'requestedSlot.date': localDate,
    });
  });

  // Best-effort post-transaction side effects
  const sysMsg = formatGigConfirmedMessage(
    enquiry.bandName, enquiry.venueName ?? '', localDate, localTime, fee,
    paymentTiming, loadInTime ?? null,
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
 * 1. Removes the slot override from the venue timetable (by gigId)
 * 2. Sets enquiry status back to 'discussing'
 * 3. Sets the gig doc to 'cancelled' (if gigId present)
 */
export async function cancelAcceptance(enquiry: Enquiry, _actingUid: string): Promise<void> {
  const venueRef   = doc(db, 'venues', enquiry.venueId);
  const enquiryRef = doc(db, 'inquiries', enquiry.id);
  const gigId      = (enquiry as any).gigId as string | undefined;

  await runTransaction(db, async (tx) => {
    const venueSnap = await tx.get(venueRef);
    const gigSnap   = gigId ? await tx.get(doc(db, 'gigs', gigId)) : null;

    let newSlots: Record<string, any[]> | null = null;
    if (venueSnap.exists() && gigId) {
      newSlots = removeSlotBooking({ ...(venueSnap.data().slots || {}) }, gigId);
    }

    if (newSlots && venueSnap.exists()) {
      tx.update(venueRef, { slots: newSlots });
    }
    tx.update(enquiryRef, { status: 'discussing', listAsBooked: false });
    if (gigId && gigSnap?.exists()) {
      const now = Timestamp.now();
      tx.update(doc(db, 'gigs', gigId), {
        status:      'cancelled',
        cancelledAt: now,
        cancelledBy: _actingUid,
        updatedAt:   now,
      });
    }
  });
}

// ── upgradeGigToBooked ───────────────────────────────────────────────────────

export async function upgradeGigToBooked(
  enquiry: Enquiry,
  fee: GigFee,
): Promise<void> {
  const enquiryRef = doc(db, 'inquiries', enquiry.id);
  const venueRef   = doc(db, 'venues', enquiry.venueId);
  const gigId      = (enquiry as any).gigId as string | undefined;

  await runTransaction(db, async (tx) => {
    const venueSnap = await tx.get(venueRef);
    if (gigId) await tx.get(doc(db, 'gigs', gigId));

    let newSlots: Record<string, any[]> | null = null;
    if (venueSnap.exists()) {
      try {
        const slots = { ...(venueSnap.data().slots || {}) };
        // Find the override by gigId and update its status to booked
        const updated = { ...slots };
        for (const day of Object.keys(updated)) {
          updated[day] = updated[day].map((s: any) =>
            s.gigId === gigId ? { ...s, status: 'booked' } : s
          );
        }
        newSlots = updated;
      } catch { /* ignore */ }
    }

    tx.update(enquiryRef, { listAsBooked: true, feeType: fee.type, fee });
    if (newSlots && venueSnap.exists()) tx.update(venueRef, { slots: newSlots });
    if (gigId) {
      tx.update(doc(db, 'gigs', gigId), { fee, listAsBooked: true, updatedAt: Timestamp.now() });
    }
  });
}

// ── Venue gig CRUD ───────────────────────────────────────────────────────────

export type VenueGigInput = {
  title: string;
  artistName: string | null;
  description: string | null;
  localDate: string;          // YYYY-MM-DD
  localStartTime: string;     // HH:MM
  localEndTime: string | null;
  doorsTime: string | null;
  ticketUrl: string | null;
  ticketPriceCents: number | null;
  room: string | null;
  listAsBooked: boolean;
  loadInTime: string | null;
  soundCheckTime: string | null;
  venueName: string;
  venueTimezone: string;
};

const DOW_TO_DAY: Record<number, string> = {
  0:'Sunday', 1:'Monday', 2:'Tuesday', 3:'Wednesday',
  4:'Thursday', 5:'Friday', 6:'Saturday',
};

function dayOfWeekFromDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  return DOW_TO_DAY[new Date(y, m - 1, d).getDay()] ?? 'Monday';
}

/**
 * Create a venue-side gig (source: 'venue_created').
 * Atomically creates the gig doc and writes the slot override.
 */
export async function createVenueGig({
  venueId, venueUid, input,
}: {
  venueId: string;
  venueUid: string;
  input: VenueGigInput;
}): Promise<string> {
  const gigRef   = doc(collection(db, 'gigs'));
  const venueRef = doc(db, 'venues', venueId);
  const gigId    = gigRef.id;

  const startAt = toStartAt(input.localDate, input.localStartTime, input.venueTimezone);
  const rawEnd  = input.localEndTime
    ? toStartAt(input.localDate, input.localEndTime, input.venueTimezone)
    : Timestamp.fromDate(new Date(startAt.toDate().getTime() + 60 * 60_000));
  const endAt = rawEnd.toDate() <= startAt.toDate()
    ? Timestamp.fromDate(new Date(rawEnd.toDate().getTime() + 24 * 3600_000))
    : rawEnd;

  await runTransaction(db, async (tx) => {
    const venueSnap = await tx.get(venueRef);
    if (!venueSnap.exists()) throw new Error('Venue not found');

    const slots: Record<string, any[]> = { ...(venueSnap.data().slots || {}) };
    const day = dayOfWeekFromDate(input.localDate);

    const slotKey: SlotKey = {
      day, date: input.localDate, time: input.localStartTime, room: input.room,
    };
    const newSlots = applySlotBooking(slots, slotKey, input.listAsBooked ? 'booked' : 'pending', {
      gigId,
      actName:          input.artistName,
      gigName:          input.title,
      ticketUrl:        input.ticketUrl,
      ticketPriceCents: input.ticketPriceCents,
      description:      input.description,
    });

    const now = Timestamp.now();
    const setLengthMs = endAt.toDate().getTime() - startAt.toDate().getTime();

    const gigData: Omit<Gig, 'id'> = {
      enquiryId:        null,
      venueId,
      venueName:        input.venueName,
      venueUid,
      artistUid:        null,
      artistName:       input.artistName,
      bandName:         input.artistName ?? '',
      title:            input.title,
      description:      input.description,
      locationText:     null,
      state:            null,
      isPublic:         false,
      status:           'confirmed',
      source:           'venue_created',
      startAt,
      endAt,
      timezone:         input.venueTimezone,
      setLengthMinutes: Math.round(setLengthMs / 60_000),
      loadInTime:       input.loadInTime,
      soundCheckTime:   input.soundCheckTime,
      room:             input.room,
      fee: {
        type:            'other',
        amountCents:     null,
        doorPercent:     null,
        ticketPriceCents: input.ticketPriceCents,
        ticketUrl:        input.ticketUrl,
        notes:            null,
        includesGst:      null,
      },
      payment:        buildFreshPayment('other', null),
      participantIds: [venueUid],
      createdBy:      venueUid,
      listAsBooked:   input.listAsBooked,
      createdAt:      now,
      updatedAt:      now,
    };

    tx.set(gigRef, gigData);
    tx.update(venueRef, { slots: newSlots });
  });

  return gigId;
}

/**
 * Update a venue-created or enquiry gig.
 * Never touches fee, participantIds, source, or agreement ids.
 */
export async function updateVenueGig({
  gigId, venueId, input,
}: {
  gigId: string;
  venueId: string;
  input: Partial<VenueGigInput>;
}): Promise<void> {
  const gigRef   = doc(db, 'gigs', gigId);
  const venueRef = doc(db, 'venues', venueId);

  await runTransaction(db, async (tx) => {
    const [gigSnap, venueSnap] = await Promise.all([tx.get(gigRef), tx.get(venueRef)]);
    if (!gigSnap.exists()) throw new Error('Gig not found');
    const gig = gigSnap.data() as Gig;

    const now = Timestamp.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (input.title != null)       updates.title = input.title;
    if (input.artistName != null)  { updates.artistName = input.artistName; updates.bandName = input.artistName; }
    if (input.description != null) updates.description = input.description;
    if (input.listAsBooked != null) updates.listAsBooked = input.listAsBooked;
    if (input.loadInTime != null)  updates.loadInTime = input.loadInTime;
    if (input.soundCheckTime != null) updates.soundCheckTime = input.soundCheckTime;
    if (input.room != null)        updates.room = input.room;

    if (input.ticketUrl != null || input.ticketPriceCents != null) {
      updates.fee = {
        ...gig.fee,
        ...(input.ticketUrl        != null ? { ticketUrl:        input.ticketUrl        } : {}),
        ...(input.ticketPriceCents != null ? { ticketPriceCents: input.ticketPriceCents } : {}),
      };
    }

    if (input.localDate && input.localStartTime && input.venueTimezone) {
      const tz = input.venueTimezone;
      updates.startAt = toStartAt(input.localDate, input.localStartTime, tz);
      const rawEnd = input.localEndTime
        ? toStartAt(input.localDate, input.localEndTime, tz)
        : gig.endAt ?? Timestamp.fromDate(new Date((updates.startAt as Timestamp).toDate().getTime() + 60 * 60_000));
      const startMs = (updates.startAt as Timestamp).toDate().getTime();
      updates.endAt = rawEnd.toDate().getTime() <= startMs
        ? Timestamp.fromDate(new Date(rawEnd.toDate().getTime() + 24 * 3600_000))
        : rawEnd;
    }

    // Update the slot override public details
    let newSlots = venueSnap.exists() ? { ...(venueSnap.data()?.slots || {}) } : null;
    if (newSlots) {
      newSlots = updateOverrideDetails(newSlots, gigId, {
        gigName:          input.title ?? gig.title,
        actName:          input.artistName ?? gig.artistName,
        ticketUrl:        input.ticketUrl ?? gig.fee.ticketUrl,
        ticketPriceCents: input.ticketPriceCents ?? gig.fee.ticketPriceCents,
        description:      input.description ?? gig.description,
      });
      if (input.listAsBooked != null) {
        for (const day of Object.keys(newSlots)) {
          newSlots[day] = newSlots[day].map((s: any) =>
            s.gigId === gigId
              ? { ...s, status: input.listAsBooked ? 'booked' : 'pending' }
              : s
          );
        }
      }
    }

    tx.update(gigRef, updates);
    if (newSlots && venueSnap.exists()) tx.update(venueRef, { slots: newSlots });
  });
}

/**
 * Cancel a venue gig: sets status to 'cancelled' and removes the slot override.
 */
export async function cancelVenueGig({
  gigId, venueId,
}: {
  gigId: string;
  venueId: string;
}): Promise<void> {
  const gigRef   = doc(db, 'gigs', gigId);
  const venueRef = doc(db, 'venues', venueId);

  await runTransaction(db, async (tx) => {
    const [gigSnap, venueSnap] = await Promise.all([tx.get(gigRef), tx.get(venueRef)]);
    if (!gigSnap.exists()) throw new Error('Gig not found');

    const newSlots = venueSnap.exists()
      ? removeSlotBooking({ ...(venueSnap.data()?.slots || {}) }, gigId)
      : null;

    tx.update(gigRef, { status: 'cancelled', updatedAt: Timestamp.now() });
    if (newSlots && venueSnap.exists()) tx.update(venueRef, { slots: newSlots });
  });
}

// ── Artist gig CRUD ──────────────────────────────────────────────────────────

export type ArtistGigInput = {
  title: string;
  venueName: string;
  locationText: string | null;
  state: string;              // AU state code e.g. 'VIC'
  localDate: string;          // YYYY-MM-DD
  localStartTime: string;     // HH:MM
  localEndTime: string | null;
  doorsTime: string | null;
  ticketUrl: string | null;
  ticketPriceCents: number | null;
  description: string | null;
  setLengthMinutes: number | null;
  isPublic: boolean;
  fee?: GigFee;
  attendance?: number | null;
};

/**
 * Create an artist-added gig and its private subcollection doc in a batch.
 */
export async function createArtistGig({
  artistUid, artistName, input,
}: {
  artistUid: string;
  artistName: string;
  input: ArtistGigInput;
}): Promise<string> {
  const gigRef     = doc(collection(db, 'gigs'));
  const privateRef = doc(db, 'gigs', gigRef.id, 'private', artistUid);
  const gigId      = gigRef.id;

  const timezone = STATE_TZ[input.state] ?? 'Australia/Melbourne';
  const startAt  = toStartAt(input.localDate, input.localStartTime, timezone);
  const rawEnd   = input.localEndTime
    ? toStartAt(input.localDate, input.localEndTime, timezone)
    : Timestamp.fromDate(new Date(startAt.toDate().getTime() + 60 * 60_000));
  const endAt = rawEnd.toDate() <= startAt.toDate()
    ? Timestamp.fromDate(new Date(rawEnd.toDate().getTime() + 24 * 3600_000))
    : rawEnd;

  const now = Timestamp.now();

  const gigData: Omit<Gig, 'id'> = {
    enquiryId:        null,
    venueId:          null,
    venueName:        input.venueName,
    venueUid:         null,
    artistUid,
    artistName,
    bandName:         artistName,
    title:            input.title,
    description:      input.description,
    locationText:     input.locationText,
    state:            input.state,
    isPublic:         input.isPublic,
    status:           'confirmed',
    source:           'artist_added',
    startAt,
    endAt,
    timezone,
    setLengthMinutes: input.setLengthMinutes ?? null,
    loadInTime:       null,
    soundCheckTime:   null,
    room:             null,
    fee: input.fee ?? {
      type:            'other',
      amountCents:     null,
      doorPercent:     null,
      ticketPriceCents: input.ticketPriceCents,
      ticketUrl:        input.ticketUrl,
      notes:            null,
      includesGst:      null,
    },
    payment:        buildFreshPayment(input.fee?.type ?? 'other', null),
    participantIds: [artistUid],
    createdBy:      artistUid,
    listAsBooked:   true,  // outside gigs default listAsBooked: true
    attendance:     input.attendance ?? null,
    createdAt:      now,
    updatedAt:      now,
  };

  const privateData: GigPrivateDoc = {
    ownerUid:  artistUid,
    notes:     '',
    docs:      [],
    updatedAt: now,
  };

  // Sequential, not batched: the private doc's security rule reads the parent
  // gig's participantIds via get(), which only sees committed documents. In a
  // batch, the sibling gig write isn't visible yet, so the rule denies the write.
  await setDoc(gigRef, gigData);
  await setDoc(privateRef, privateData);

  return gigId;
}

/** Update an artist-added gig. */
export async function updateArtistGig({
  gigId, artistUid, input,
}: {
  gigId: string;
  artistUid: string;
  input: Partial<ArtistGigInput>;
}): Promise<void> {
  const gigRef = doc(db, 'gigs', gigId);
  const updates: Record<string, unknown> = { updatedAt: Timestamp.now() };

  if (input.title        != null) updates.title        = input.title;
  if (input.venueName    != null) updates.venueName     = input.venueName;
  if (input.locationText != null) updates.locationText  = input.locationText;
  if (input.description  != null) updates.description   = input.description;
  if (input.isPublic     != null) updates.isPublic      = input.isPublic;
  if (input.setLengthMinutes != null) updates.setLengthMinutes = input.setLengthMinutes;
  if (input.ticketUrl != null || input.ticketPriceCents != null) {
    // partial fee update — read current fee first
    const snap = await import('firebase/firestore').then(m =>
      m.getDoc(doc(db, 'gigs', gigId))
    );
    const current = snap.data() as Gig | undefined;
    updates.fee = {
      ...(current?.fee ?? {}),
      ...(input.ticketUrl        != null ? { ticketUrl:        input.ticketUrl        } : {}),
      ...(input.ticketPriceCents != null ? { ticketPriceCents: input.ticketPriceCents } : {}),
    };
  }

  if (input.state && input.localDate && input.localStartTime) {
    const tz = STATE_TZ[input.state] ?? 'Australia/Melbourne';
    updates.state    = input.state;
    updates.timezone = tz;
    updates.startAt  = toStartAt(input.localDate, input.localStartTime, tz);
    const rawEnd = input.localEndTime
      ? toStartAt(input.localDate, input.localEndTime, tz)
      : Timestamp.fromDate(new Date((updates.startAt as Timestamp).toDate().getTime() + 60 * 60_000));
    updates.endAt = rawEnd.toDate().getTime() <= (updates.startAt as Timestamp).toDate().getTime()
      ? Timestamp.fromDate(new Date(rawEnd.toDate().getTime() + 24 * 3600_000))
      : rawEnd;
  }

  if (input.attendance !== undefined) updates.attendance = input.attendance ?? null;

  await updateDoc(gigRef, updates);
}

/**
 * Recompute and store the average draw on the artist's bandProfile.
 * Called after any gig save that includes an attendance value.
 */
export async function recomputeAverageDraw(artistUid: string): Promise<void> {
  try {
    const snap = await getDocs(query(
      collection(db, 'gigs'),
      where('artistUid', '==', artistUid),
      where('status', '==', 'confirmed'),
    ));
    const now = new Date();
    const values: number[] = [];
    snap.docs.forEach(d => {
      const g = d.data() as Gig;
      const endAt = g.endAt?.toDate() ?? new Date(g.startAt.toDate().getTime() + 3_600_000);
      if (endAt < now && typeof g.attendance === 'number' && g.attendance > 0) {
        values.push(g.attendance);
      }
    });
    if (values.length === 0) return;
    const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
    await updateDoc(doc(db, 'bandProfiles', artistUid), { averageDraw: avg });
  } catch {
    // silent — non-critical
  }
}

/**
 * Set the artist's isPublic toggle on a gig.
 * Only valid for the gig's artistUid.
 */
export async function setGigPublic(gigId: string, isPublic: boolean): Promise<void> {
  await updateDoc(doc(db, 'gigs', gigId), { isPublic, updatedAt: Timestamp.now() });
}

/**
 * Delete an artist-added gig:
 * 1. Delete storage files first (best-effort)
 * 2. Batch-delete the private doc and the gig
 * The Cloud Function trigger removes publicGigs.
 */
export async function deleteArtistGig({
  gigId, artistUid, storagePaths = [],
}: {
  gigId: string;
  artistUid: string;
  storagePaths?: string[];
}): Promise<void> {
  for (const path of storagePaths) {
    try {
      await deleteObject(sRef(storage, path));
    } catch { /* best-effort */ }
  }

  const batch = writeBatch(db);
  batch.delete(doc(db, 'gigs', gigId, 'private', artistUid));
  batch.delete(doc(db, 'gigs', gigId));
  await batch.commit();
}

/**
 * Save (overwrite) a user's private gig data.
 * Only callable by a participant of the gig.
 */
export async function savePrivateGigData(
  gigId: string,
  uid: string,
  data: Pick<GigPrivateDoc, 'notes' | 'docs'>,
): Promise<void> {
  await updateDoc(doc(db, 'gigs', gigId, 'private', uid), {
    notes:     data.notes,
    docs:      data.docs,
    updatedAt: Timestamp.now(),
  });
}

// ── Upload helper ────────────────────────────────────────────────────────────

export type UploadProgress = { bytes: number; total: number };

/**
 * Upload a gig doc to gigDocs/{uid}/{gigId}/{fileName} with progress callback.
 * Returns { url, storagePath }.
 */
export async function uploadGigDoc(
  uid: string,
  gigId: string,
  file: { uri: string; name: string; mimeType?: string },
  onProgress?: (p: UploadProgress) => void,
): Promise<{ url: string; storagePath: string }> {
  const ext  = file.name.split('.').pop() ?? 'bin';
  const path = `gigDocs/${uid}/${gigId}/${Date.now()}.${ext}`;
  const ref  = sRef(storage, path);

  const res  = await fetch(file.uri);
  const blob = await res.blob();

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref, blob, file.mimeType ? { contentType: file.mimeType } : undefined);
    task.on(
      'state_changed',
      snap => onProgress?.({ bytes: snap.bytesTransferred, total: snap.totalBytes }),
      reject,
      () => resolve(),
    );
  });

  const url = await getDownloadURL(ref);
  return { url, storagePath: path };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const _DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Build the system message posted when a gig is confirmed.
 * Format: "Gig confirmed: Fri 14 Nov · 8:00 PM · $400 flat · pay after the gig · load-in 6:30 PM"
 */
export function formatGigConfirmedMessage(
  bandName: string,
  venueName: string,
  localDate: string,    // YYYY-MM-DD
  localTime: string,
  fee?: GigFee | null,
  paymentTiming?: 'before' | 'after' | null,
  loadInTime?: string | null,
): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const dt  = new Date(y, m - 1, d);
  const dow = _DOW[dt.getDay()];
  const dmm = `${d} ${_MON[m - 1]}`;

  const parts: string[] = [`Gig confirmed: ${dow} ${dmm}`];
  if (localTime) parts.push(localTime);
  if (fee) {
    if ((fee.type === 'flat' || fee.type === 'guarantee_vs_door') && fee.amountCents != null) {
      parts.push(`$${Math.round(fee.amountCents / 100)} flat`);
    } else if (fee.type === 'door_split' && fee.doorPercent != null) {
      parts.push(`${fee.doorPercent}% door`);
    }
  }
  if (paymentTiming) {
    parts.push(`pay ${paymentTiming} the gig`);
  }
  if (loadInTime) {
    parts.push(`load-in ${loadInTime}`);
  }

  return parts.join(' · ');
}

