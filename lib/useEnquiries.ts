import { useState, useEffect } from 'react';
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc,
  doc, query, orderBy, where, getDoc, arrayUnion, increment,
  writeBatch, getDocs, limit,
} from 'firebase/firestore';
import { db } from './firebase';

export type ParticipantRole  = 'venue' | 'headliner' | 'support';
export type ParticipantState = 'invited' | 'confirmed' | 'declined' | 'left';

export type Participant = {
  id: string;
  userId: string;
  role: ParticipantRole;
  state: ParticipantState;
  invitedBy: string | null;
  displayName: string;
  photoUrl: string | null;
  joinedAt: string | null;
  respondedAt: string | null;
  leftAt: string | null;
};

export type Enquiry = {
  id: string;
  bandName: string;
  venueName: string;
  venueId: string;
  createdBy: string;
  /**
   * New values: 'enquired' | 'discussing' | 'confirmed' | 'declined' | 'cancelled'
   * Legacy values (existing Firestore docs): 'pending' | 'accepted'
   * Read normalizeEnquiryStatus() to map legacy → new before using in UI logic.
   */
  status: 'enquired' | 'discussing' | 'confirmed' | 'declined' | 'cancelled' | 'pending' | 'accepted';
  submittedAt: string;
  additionalInfo?: string;
  requestedSlot: {
    day: string;
    date?: string | null;
    time: string;
    room?: string | null;
    slotType: string;
    setLength: string;
  };
  // band profile snapshot fields
  genre?: string[];
  location?: string;
  artistType?: string;
  about?: string;
  photoUrl?: string;
  // scheduling
  loadInTime?: string;
  soundCheckTime?: string;
  // timetable booking
  listAsBooked?: boolean;
  declineReason?: string;
  // read tracking
  lastMessageAt?: string;
  lastReadAt?: Record<string, string>;
  [key: string]: any;
};

export type Message = {
  id: string;
  inquiryId: string;
  sender: string;
  text: string;
  timestamp: string;
  /** 'system' messages are rendered inline as centered event labels (no avatar, no sender) */
  type?: 'system';
};

// ── Status normalisation ────────────────────────────────────────────────────

/** Maps legacy Firestore status values to the current canonical set. */
export function normalizeEnquiryStatus(
  status: Enquiry['status'],
): 'enquired' | 'discussing' | 'confirmed' | 'declined' | 'cancelled' {
  if (status === 'pending')  return 'enquired';
  if (status === 'accepted') return 'confirmed';
  return status as 'enquired' | 'discussing' | 'confirmed' | 'declined' | 'cancelled';
}

// ── Rollup ──────────────────────────────────────────────────────────────────

/**
 * Derives the thread status from participant records.
 * Active = state is 'invited' or 'confirmed'. 'declined' and 'left' are excluded.
 */
function computeRollupStatus(
  participants: Participant[],
): 'enquired' | 'discussing' | 'confirmed' {
  const active = participants.filter(p => p.state === 'invited' || p.state === 'confirmed');
  if (active.length === 0) return 'discussing';
  if (active.every(p => p.state === 'confirmed')) return 'confirmed';
  if (active.every(p => p.state === 'invited'))   return 'enquired';
  return 'discussing';
}

async function updateRollupStatus(enquiryId: string): Promise<void> {
  const snap = await getDocs(collection(db, 'inquiries', enquiryId, 'participants'));
  const participants = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Participant[];
  if (participants.length === 0) return; // legacy thread — don't overwrite explicit status
  const status = computeRollupStatus(participants);
  await updateDoc(doc(db, 'inquiries', enquiryId), { status });
}

// ── Artist inbox — listens to all enquiries they submitted ──────────────────
export function useArtistEnquiries(uid: string | null) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    const q = query(collection(db, 'inquiries'), where('createdBy', '==', uid));
    const unsub = onSnapshot(q, snap => {
      setEnquiries(
        (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Enquiry[])
          .filter(e => !e.deletedBy?.includes(uid))
      );
      setLoading(false);
    }, err => {
      console.error('useArtistEnquiries:', err.message);
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  return { enquiries, loading };
}

/**
 * Returns enquiries where this artist was invited as a support act.
 * Uses the denormalised `participantUids` array written by `inviteParticipants`.
 * Only enquiries they didn't create themselves (those come from useArtistEnquiries).
 */
export function useSupportEnquiries(uid: string | null) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    const q = query(
      collection(db, 'inquiries'),
      where('participantUids', 'array-contains', uid),
    );
    const unsub = onSnapshot(q, snap => {
      setEnquiries(
        (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Enquiry[])
          // Exclude enquiries they created (already shown via useArtistEnquiries)
          .filter(e => e.createdBy !== uid && !e.deletedBy?.includes(uid))
      );
      setLoading(false);
    }, () => {
      // participantUids field not yet indexed or doesn't exist — safe to ignore
      setEnquiries([]);
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  return { enquiries, loading };
}

// ── Agent inbox — listens to enquiries for all represented musicians ────────
export type RosterEntry = {
  type: 'artist' | 'venue';
  id: string;
  name: string;
};

export function useAgentEnquiries(agentUid: string | null) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [roster, setRoster]       = useState<RosterEntry[]>([]);

  // Live roster: listen to both claims collections in real-time
  useEffect(() => {
    if (!agentUid) { setRoster([]); setLoading(false); return; }

    let artistEntries: RosterEntry[] = [];
    let venueEntries:  RosterEntry[] = [];

    const unsub1 = onSnapshot(
      query(collection(db, 'agentClaims'), where('agentUid', '==', agentUid)),
      snap => {
        artistEntries = snap.docs
          .filter(d => d.data().status === 'approved')
          .map(d => ({ type: 'artist' as const, id: d.data().artistUid as string, name: d.data().artistName as string }));
        setRoster([...artistEntries, ...venueEntries]);
      },
      () => {},
    );

    const unsub2 = onSnapshot(
      query(collection(db, 'agentVenueClaims'), where('agentUid', '==', agentUid)),
      snap => {
        venueEntries = snap.docs
          .filter(d => d.data().status === 'approved')
          .map(d => ({ type: 'venue' as const, id: d.data().venueId as string, name: d.data().venueName as string }));
        setRoster([...artistEntries, ...venueEntries]);
      },
      () => {},
    );

    return () => { unsub1(); unsub2(); };
  }, [agentUid]);

  // Subscribe to enquiries whenever roster changes
  const rosterKey = roster.map(r => r.id).join(',');
  useEffect(() => {
    const artistUids = roster.filter(r => r.type === 'artist').map(r => r.id);
    const venueIds   = roster.filter(r => r.type === 'venue').map(r => r.id);
    if (artistUids.length === 0 && venueIds.length === 0) { setEnquiries([]); setLoading(false); return; }

    const unsubs: (() => void)[] = [];
    let artistEnqs: Enquiry[] = [];
    let venueEnqs:  Enquiry[] = [];
    let artistDone = artistUids.length === 0;
    let venueDone  = venueIds.length  === 0;

    function merge() {
      if (!artistDone || !venueDone) return;
      const map = new Map<string, Enquiry>();
      [...artistEnqs, ...venueEnqs].forEach(e => map.set(e.id, e));
      setEnquiries(Array.from(map.values()));
      setLoading(false);
    }

    if (artistUids.length > 0) {
      unsubs.push(onSnapshot(
        query(collection(db, 'inquiries'), where('createdBy', 'in', artistUids)),
        snap => { artistEnqs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Enquiry[]; artistDone = true; merge(); },
        () => { artistDone = true; merge(); },
      ));
    }
    if (venueIds.length > 0) {
      unsubs.push(onSnapshot(
        query(collection(db, 'inquiries'), where('venueId', 'in', venueIds)),
        snap => { venueEnqs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Enquiry[]; venueDone = true; merge(); },
        () => { venueDone = true; merge(); },
      ));
    }
    return () => unsubs.forEach(u => u());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

  return { enquiries, loading, roster };
}

// ── Venue inbox — listens to all enquiries for a venueId ───────────────────
export function useVenueEnquiries(venueId: string | null) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    const q = query(collection(db, 'inquiries'), where('venueId', '==', venueId));
    const unsub = onSnapshot(q, snap => {
      setEnquiries(
        (snap.docs.map(d => ({ id: d.id, ...d.data() })) as Enquiry[])
          .filter(e => !e.deletedBy?.includes(venueId))
      );
      setLoading(false);
    }, err => {
      console.error('useVenueEnquiries:', err.message);
      setLoading(false);
    });
    return unsub;
  }, [venueId]);

  return { enquiries, loading };
}

// ── Participants for a single enquiry ───────────────────────────────────────
export function useParticipants(enquiryId: string | null): Participant[] {
  const [participants, setParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    if (!enquiryId) return;
    const unsub = onSnapshot(
      collection(db, 'inquiries', enquiryId, 'participants'),
      snap => {
        setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Participant[]);
      },
    );
    return unsub;
  }, [enquiryId]);

  return participants;
}

// ── Messages for a single enquiry ──────────────────────────────────────────
export function useMessages(enquiryId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (!enquiryId) return;
    const q = query(
      collection(db, 'messages'),
      where('inquiryId', '==', enquiryId),
      orderBy('timestamp', 'asc'),
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Message[]);
    });
  }, [enquiryId]);

  return messages;
}

// ── Write helpers ───────────────────────────────────────────────────────────

export async function addEnquiry(inquiry: Omit<Enquiry, 'id'>): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(collection(db, 'inquiries'), {
    ...inquiry,
    status: 'enquired',
    submittedAt: now,
    lastMessageAt: now,
    lastReadAt: { [inquiry.createdBy]: now },
    // denormalised array so support-act inbox queries can filter cheaply
    participantUids: [inquiry.createdBy],
  });

  // Create the headliner participant record
  await addDoc(collection(db, 'inquiries', ref.id, 'participants'), {
    userId:      inquiry.createdBy,
    role:        'headliner',
    state:       'confirmed',
    invitedBy:   null,
    displayName: inquiry.bandName,
    photoUrl:    inquiry.photoUrl ?? null,
    joinedAt:    now,
    respondedAt: now,
    leftAt:      null,
  });

  return ref.id;
}

export async function updateEnquiryStatus(
  id: string,
  status: Enquiry['status'],
  reason?: string,
) {
  // Track reply time: first response from venue (enquired/pending → any action)
  const trackedStatuses: Enquiry['status'][] = ['confirmed', 'accepted', 'discussing', 'declined'];
  if (trackedStatuses.includes(status)) {
    try {
      const snap = await getDoc(doc(db, 'inquiries', id));
      if (snap.exists()) {
        const data = snap.data() as Enquiry;
        const wasInitial = data.status === 'pending' || data.status === 'enquired';
        if (wasInitial && data.submittedAt && data.venueId) {
          const elapsedMs = Date.now() - new Date(data.submittedAt).getTime();
          await updateDoc(doc(db, 'venues', data.venueId), {
            'replyStats.totalMs': increment(elapsedMs),
            'replyStats.count':   increment(1),
          });
        }
      }
    } catch {}
  }
  await updateDoc(doc(db, 'inquiries', id), {
    status,
    ...(reason && { declineReason: reason }),
  });
}

export async function sendMessage(inquiryId: string, sender: string, text: string) {
  const now = new Date().toISOString();
  await Promise.all([
    addDoc(collection(db, 'messages'), { inquiryId, sender, text, timestamp: now }),
    updateDoc(doc(db, 'inquiries', inquiryId), { lastMessageAt: now }),
  ]);
}

/** Post a system event message (e.g. "X added Y to the gig") — no sender, rendered inline */
export async function postSystemMessage(enquiryId: string, text: string): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    addDoc(collection(db, 'messages'), {
      inquiryId: enquiryId,
      sender: '',
      text,
      timestamp: now,
      type: 'system',
    }),
    updateDoc(doc(db, 'inquiries', enquiryId), { lastMessageAt: now }),
  ]);
}

export async function markEnquiryRead(id: string, uid: string) {
  await updateDoc(doc(db, 'inquiries', id), {
    [`lastReadAt.${uid}`]: new Date().toISOString(),
  });
}

export async function cancelEnquiry(id: string) {
  await deleteDoc(doc(db, 'inquiries', id));
}

/** Soft-delete an enquiry for one party — hides it from their inbox only */
export async function archiveEnquiry(id: string, uid: string) {
  await updateDoc(doc(db, 'inquiries', id), { deletedBy: arrayUnion(uid) });
}

// ── Participant management ──────────────────────────────────────────────────

/**
 * Ensure a venue participant record exists for this enquiry.
 * Called when the venue first responds (they're authenticated at that point).
 */
export async function ensureVenueParticipant(
  enquiryId: string,
  venueUserId: string,
  displayName: string,
  photoUrl: string | null,
): Promise<void> {
  const snap = await getDocs(
    query(
      collection(db, 'inquiries', enquiryId, 'participants'),
      where('userId', '==', venueUserId),
    )
  );
  if (!snap.empty) return; // already exists
  const now = new Date().toISOString();
  await addDoc(collection(db, 'inquiries', enquiryId, 'participants'), {
    userId:      venueUserId,
    role:        'venue',
    state:       'confirmed',
    invitedBy:   null,
    displayName,
    photoUrl:    photoUrl ?? null,
    joinedAt:    now,
    respondedAt: now,
    leftAt:      null,
  });
}

/**
 * Update the headliner participant state to 'confirmed' (used when venue confirms the gig).
 * Also creates the venue participant record if it doesn't exist.
 */
export async function confirmHeadliner(
  enquiryId: string,
  headlinerUserId: string,
  venueUserId: string,
  venueDisplayName: string,
  venuePhotoUrl: string | null,
): Promise<void> {
  const now = new Date().toISOString();

  // Ensure venue participant exists
  await ensureVenueParticipant(enquiryId, venueUserId, venueDisplayName, venuePhotoUrl);

  // Find + update headliner participant
  const snap = await getDocs(
    query(
      collection(db, 'inquiries', enquiryId, 'participants'),
      where('userId', '==', headlinerUserId),
    )
  );
  if (!snap.empty) {
    await updateDoc(snap.docs[0].ref, { state: 'confirmed', respondedAt: now });
  } else {
    // Headliner record missing (legacy enquiry) — create it as confirmed
    const enqSnap = await getDoc(doc(db, 'inquiries', enquiryId));
    const enqData = enqSnap.data() as Enquiry | undefined;
    await addDoc(collection(db, 'inquiries', enquiryId, 'participants'), {
      userId:      headlinerUserId,
      role:        'headliner',
      state:       'confirmed',
      invitedBy:   null,
      displayName: enqData?.bandName ?? '',
      photoUrl:    enqData?.photoUrl ?? null,
      joinedAt:    now,
      respondedAt: now,
      leftAt:      null,
    });
  }
}

/**
 * Invite one or more musicians to a gig thread.
 * Creates participant records and posts a batched system message.
 */
export async function inviteParticipants(
  enquiryId: string,
  invitees: { userId: string; displayName: string; photoUrl: string | null }[],
  invitedBy: string,
  inviterName: string,
): Promise<void> {
  if (invitees.length === 0) return;
  const now = new Date().toISOString();
  const batch = writeBatch(db);

  for (const invitee of invitees) {
    const ref = doc(collection(db, 'inquiries', enquiryId, 'participants'));
    batch.set(ref, {
      userId:      invitee.userId,
      role:        'support',
      state:       'invited',
      invitedBy,
      displayName: invitee.displayName,
      photoUrl:    invitee.photoUrl ?? null,
      joinedAt:    now,
      respondedAt: null,
      leftAt:      null,
    });
  }

  // Denormalise participantUids on the enquiry doc for cheap inbox filtering
  batch.update(doc(db, 'inquiries', enquiryId), {
    participantUids: arrayUnion(...invitees.map(i => i.userId)),
  });

  await batch.commit();

  // System message (batched: "X added Y and Z to the gig")
  const names = invitees.map(i => i.displayName);
  const namesList = names.length === 1
    ? names[0]
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  await postSystemMessage(enquiryId, `${inviterName} added ${namesList} to the gig`);

  // Recompute rollup
  await updateRollupStatus(enquiryId);
}

/**
 * Support act leaves a gig (delete-as-leave).
 * Sets participant state to 'left', posts system message, and soft-deletes from the actor's inbox.
 */
export async function leaveGig(
  enquiryId: string,
  participantId: string,
  uid: string,
  leaverName: string,
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    updateDoc(doc(db, 'inquiries', enquiryId, 'participants', participantId), {
      state:  'left',
      leftAt: now,
    }),
    updateDoc(doc(db, 'inquiries', enquiryId), {
      deletedBy: arrayUnion(uid),
    }),
  ]);
  await postSystemMessage(enquiryId, `${leaverName} left the group`);
  await updateRollupStatus(enquiryId);
}

/**
 * Venue removes a support act from the gig.
 * Semantically equivalent to 'left' but initiated by the venue, not the participant.
 */
export async function removeParticipantFromGig(
  enquiryId: string,
  participantId: string,
  removedUserId: string,
  removedName: string,
  actorName: string,
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    updateDoc(doc(db, 'inquiries', enquiryId, 'participants', participantId), {
      state:  'left',
      leftAt: now,
    }),
    updateDoc(doc(db, 'inquiries', enquiryId), {
      deletedBy: arrayUnion(removedUserId),
    }),
  ]);
  await postSystemMessage(enquiryId, `${actorName} removed ${removedName} from the gig`);
  await updateRollupStatus(enquiryId);
}

// ── Past collaborators for invite sheet ─────────────────────────────────────

export type CollaboratorInfo = {
  userId: string;
  displayName: string;
  photoUrl: string | null;
};

/**
 * Returns musicians who have previously played a specific venue
 * (confirmed/accepted enquiries where venueId matches).
 */
export async function fetchVenuePastCollaborators(venueId: string): Promise<CollaboratorInfo[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'inquiries'),
        where('venueId', '==', venueId),
        where('status', 'in', ['confirmed', 'accepted']),
        limit(50),
      )
    );
    const seen = new Set<string>();
    const result: CollaboratorInfo[] = [];
    for (const d of snap.docs) {
      const data = d.data() as Enquiry;
      if (!data.createdBy || seen.has(data.createdBy)) continue;
      seen.add(data.createdBy);
      result.push({
        userId:      data.createdBy,
        displayName: data.bandName,
        photoUrl:    data.photoUrl ?? null,
      });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Returns musicians the headliner has previously performed alongside
 * (other participants in confirmed gigs where this user was a participant).
 */
export async function fetchHeadlinerPastCollaborators(headlinerUid: string): Promise<CollaboratorInfo[]> {
  try {
    // Find enquiries where headliner was a participant (support role in other gigs)
    const snap = await getDocs(
      query(
        collection(db, 'inquiries'),
        where('participantUids', 'array-contains', headlinerUid),
        where('status', 'in', ['confirmed', 'accepted']),
        limit(20),
      )
    );
    const seen = new Set<string>([headlinerUid]);
    const result: CollaboratorInfo[] = [];
    for (const d of snap.docs) {
      const participantsSnap = await getDocs(
        collection(db, 'inquiries', d.id, 'participants')
      );
      for (const pd of participantsSnap.docs) {
        const p = pd.data() as Participant;
        if (!p.userId || seen.has(p.userId) || p.role === 'venue') continue;
        seen.add(p.userId);
        result.push({ userId: p.userId, displayName: p.displayName, photoUrl: p.photoUrl });
      }
    }
    return result;
  } catch {
    return [];
  }
}

// ── Timetable helpers ───────────────────────────────────────────────────────

const normSlot = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

/** Write/update a date-specific booked or pending slot override on the venue's timetable. */
export async function bookSlotOnTimetable(enquiry: Enquiry, listAsBooked: boolean) {
  const { day, date, time, room } = enquiry.requestedSlot;
  if (!day || !time) return;

  const venueSnap = await getDoc(doc(db, 'venues', enquiry.venueId));
  if (!venueSnap.exists()) return;

  const slots: Record<string, any[]> = { ...(venueSnap.data().slots || {}) };
  const daySlots = [...(slots[day] || [])];
  const slotDate = date ?? null;

  const existingIdx = daySlots.findIndex(s =>
    s.date === slotDate &&
    normSlot(s.time) === normSlot(time) &&
    (!room || normSlot(s.room ?? '') === normSlot(room))
  );

  const newStatus = listAsBooked ? 'booked' : 'pending';

  if (existingIdx >= 0) {
    daySlots[existingIdx] = { ...daySlots[existingIdx], status: newStatus, bandName: enquiry.bandName };
  } else {
    const openSlot = daySlots.find(s => !s.date && s.status === 'open' && normSlot(s.time) === normSlot(time));
    daySlots.push({
      ...(openSlot ? { ...openSlot } : {}),
      id: `${day.toLowerCase()}-${slotDate}-${normSlot(time)}`,
      time,
      date: slotDate,
      status: newStatus,
      bandName: enquiry.bandName,
      room: room ?? null,
    });
  }

  slots[day] = daySlots;
  await Promise.all([
    updateDoc(doc(db, 'venues', enquiry.venueId), { slots }),
    updateDoc(doc(db, 'inquiries', enquiry.id), { listAsBooked }),
  ]);
}

// ── Inbox badge count ───────────────────────────────────────────────────────

/** Returns the number of pending enquiries for the current user (artist or venue). */
export function useInboxBadgeCount(uid: string | null, venueId: string | null): number {
  const { enquiries: artistEnqs } = useArtistEnquiries(!venueId ? uid : null);
  const { enquiries: venueEnqs  } = useVenueEnquiries(venueId);
  const enqs = venueId ? venueEnqs : artistEnqs;
  return enqs.filter(e => {
    const s = normalizeEnquiryStatus(e.status);
    return s === 'enquired';
  }).length;
}

// cancelAcceptance has been moved to lib/useGigs.ts (transactional version).
