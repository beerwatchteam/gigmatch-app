import { useState, useEffect } from 'react';
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc,
  doc, query, orderBy, where,
} from 'firebase/firestore';
import { db } from './firebase';

export type Enquiry = {
  id: string;
  bandName: string;
  venueName: string;
  venueId: string;
  createdBy: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
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
