import { useState, useEffect } from 'react';
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc,
  doc, query, orderBy, where, getDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export type Enquiry = {
  id: string;
  bandName: string;
  venueName: string;
  venueId: string;
  createdBy: string;
  status: 'pending' | 'discussing' | 'accepted' | 'declined' | 'cancelled';
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
  // timetable booking
  listAsBooked?: boolean;
  [key: string]: any;
};

export type Message = {
  id: string;
  inquiryId: string;
  sender: string;
  text: string;
  timestamp: string;
};

// ── Artist inbox — listens to all enquiries they submitted ──
export function useArtistEnquiries(uid: string | null) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    const q = query(collection(db, 'inquiries'), where('createdBy', '==', uid));
    const unsub = onSnapshot(q, snap => {
      setEnquiries(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Enquiry[]);
      setLoading(false);
    }, err => {
      console.error('useArtistEnquiries:', err.message);
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  return { enquiries, loading };
}

// ── Venue inbox — listens to all enquiries for a venueId ──
export function useVenueEnquiries(venueId: string | null) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    const q = query(collection(db, 'inquiries'), where('venueId', '==', venueId));
    const unsub = onSnapshot(q, snap => {
      setEnquiries(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Enquiry[]);
      setLoading(false);
    }, err => {
      console.error('useVenueEnquiries:', err.message);
      setLoading(false);
    });
    return unsub;
  }, [venueId]);

  return { enquiries, loading };
}

// ── Messages for a single enquiry ──
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

// ── Write helpers ──
export async function addEnquiry(inquiry: Omit<Enquiry, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'inquiries'), {
    ...inquiry,
    status: 'pending',
    submittedAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateEnquiryStatus(
  id: string,
  status: Enquiry['status'],
  reason?: string,
) {
  await updateDoc(doc(db, 'inquiries', id), {
    status,
    ...(reason && { declineReason: reason }),
  });
}

export async function sendMessage(inquiryId: string, sender: string, text: string) {
  await addDoc(collection(db, 'messages'), {
    inquiryId, sender, text,
    timestamp: new Date().toISOString(),
  });
}

export async function cancelEnquiry(id: string) {
  await deleteDoc(doc(db, 'inquiries', id));
}

// ── Timetable helpers ──

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
    // Base on matching open recurring slot if found
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

/** Remove the booked/pending slot override and move enquiry back to discussing. */
export async function cancelAcceptance(enquiry: Enquiry) {
  const { day, date, time, room } = enquiry.requestedSlot;

  if (day && time) {
    const venueSnap = await getDoc(doc(db, 'venues', enquiry.venueId));
    if (venueSnap.exists()) {
      const slots: Record<string, any[]> = { ...(venueSnap.data().slots || {}) };
      const slotDate = date ?? null;
      slots[day] = (slots[day] || []).filter(s =>
        !(s.date === slotDate &&
          normSlot(s.time) === normSlot(time) &&
          (!room || normSlot(s.room ?? '') === normSlot(room)))
      );
      await updateDoc(doc(db, 'venues', enquiry.venueId), { slots });
    }
  }

  await updateDoc(doc(db, 'inquiries', enquiry.id), { status: 'discussing', listAsBooked: false });
}
