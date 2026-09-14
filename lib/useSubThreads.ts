import { useState, useEffect } from 'react';
import {
  collection, doc, addDoc, setDoc, updateDoc, getDoc,
  onSnapshot, query, orderBy, where, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export type SubThread = {
  id: string;
  participantAId: string;
  participantBId: string;
  lastMessageAt: string | null;
};

export type SubMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
};

/** Deterministic sub-thread ID for two UIDs within a gig */
export function mkSubThreadId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

/** Live listener for the sub-thread doc between two users in a gig */
export function useSubThread(
  enquiryId: string | null,
  uidA: string,
  uidB: string,
): SubThread | null {
  const [thread, setThread] = useState<SubThread | null>(null);

  useEffect(() => {
    if (!enquiryId || !uidA || !uidB) return;
    const id = mkSubThreadId(uidA, uidB);
    return onSnapshot(doc(db, 'inquiries', enquiryId, 'subThreads', id), snap => {
      if (!snap.exists()) { setThread(null); return; }
      const d = snap.data();
      setThread({
        id: snap.id,
        participantAId: d.participantAId ?? '',
        participantBId: d.participantBId ?? '',
        lastMessageAt: d.lastMessageAt?.toDate?.()?.toISOString() ?? null,
      });
    });
  }, [enquiryId, uidA, uidB]);

  return thread;
}

/** Live messages for a sub-thread */
export function useSubThreadMessages(
  enquiryId: string | null,
  subThreadId: string | null,
): SubMessage[] {
  const [messages, setMessages] = useState<SubMessage[]>([]);

  useEffect(() => {
    if (!enquiryId || !subThreadId) return;
    const q = query(
      collection(db, 'inquiries', enquiryId, 'subThreads', subThreadId, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({
        id:        d.id,
        senderId:  d.data().senderId,
        text:      d.data().text,
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
      })));
    });
  }, [enquiryId, subThreadId]);

  return messages;
}

/**
 * Get or create a 1:1 sub-thread between two users within a gig.
 * Returns the sub-thread ID.
 */
export async function getOrCreateSubThread(
  enquiryId: string,
  uidA: string,
  uidB: string,
): Promise<string> {
  const id  = mkSubThreadId(uidA, uidB);
  const ref = doc(db, 'inquiries', enquiryId, 'subThreads', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      participantAId: uidA,
      participantBId: uidB,
      lastMessageAt:  null,
      createdAt:      serverTimestamp(),
    });
  }
  return id;
}

/** Send a message in a sub-thread */
export async function sendSubThreadMessage(
  enquiryId: string,
  subThreadId: string,
  senderUid: string,
  text: string,
): Promise<void> {
  await Promise.all([
    addDoc(
      collection(db, 'inquiries', enquiryId, 'subThreads', subThreadId, 'messages'),
      { senderId: senderUid, text, createdAt: serverTimestamp() },
    ),
    updateDoc(doc(db, 'inquiries', enquiryId, 'subThreads', subThreadId), {
      lastMessageAt: serverTimestamp(),
    }),
  ]);
}
