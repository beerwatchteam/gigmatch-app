import { useState, useEffect } from 'react';
import {
  collection, doc, addDoc, setDoc, updateDoc, getDoc,
  arrayUnion, arrayRemove, onSnapshot, query, orderBy,
  serverTimestamp, where,
} from 'firebase/firestore';
import { db } from './firebase';

export interface DM {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export interface DMConv {
  id: string;
  participants: string[];
  participantNames: Record<string, string>;
  participantPhotos: Record<string, string>;
  initiatedBy: string;
  /** UIDs who have accepted — initiator is auto-added on creation */
  acceptedBy: string[];
  /** UIDs who have soft-deleted this conversation */
  deletedBy: string[];
  lastMessage: string;
  lastMessageAt: string;
}

/** Deterministic conversation ID for two users */
export function mkDMId(uid1: string, uid2: string) {
  return [uid1, uid2].sort().join('_');
}

/** Live list of all DM conversations for a user (excludes deleted) */
export function useDMConversations(uid: string | null) {
  const [convs, setConvs] = useState<DMConv[]>([]);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'directMessages'),
      where('participants', 'array-contains', uid),
      orderBy('lastMessageAt', 'desc'),
    );
    return onSnapshot(q, snap => {
      setConvs(
        snap.docs
          .map(d => {
            const data = d.data();
            return {
              id: d.id,
              participants:       data.participants       ?? [],
              participantNames:   data.participantNames   ?? {},
              participantPhotos:  data.participantPhotos  ?? {},
              initiatedBy:        data.initiatedBy        ?? '',
              acceptedBy:         data.acceptedBy         ?? [],
              deletedBy:          data.deletedBy          ?? [],
              lastMessage:        data.lastMessage        ?? '',
              lastMessageAt:      data.lastMessageAt?.toDate?.()?.toISOString() ?? '',
            } as DMConv;
          })
          .filter(c => !c.deletedBy.includes(uid))
      );
    });
  }, [uid]);

  return convs;
}

/** Live listener for a single conversation document */
export function useDMConv(convId: string | null) {
  const [conv, setConv] = useState<DMConv | null>(null);

  useEffect(() => {
    if (!convId) return;
    return onSnapshot(doc(db, 'directMessages', convId), d => {
      if (!d.exists()) { setConv(null); return; }
      const data = d.data();
      setConv({
        id: d.id,
        participants:       data.participants       ?? [],
        participantNames:   data.participantNames   ?? {},
        participantPhotos:  data.participantPhotos  ?? {},
        initiatedBy:        data.initiatedBy        ?? '',
        acceptedBy:         data.acceptedBy         ?? [],
        deletedBy:          data.deletedBy          ?? [],
        lastMessage:        data.lastMessage        ?? '',
        lastMessageAt:      data.lastMessageAt?.toDate?.()?.toISOString() ?? '',
      });
    });
  }, [convId]);

  return conv;
}

/** Live messages for a conversation */
export function useDMMessages(convId: string | null) {
  const [messages, setMessages] = useState<DM[]>([]);

  useEffect(() => {
    if (!convId) return;
    const q = query(
      collection(db, 'directMessages', convId, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({
        id: d.id,
        senderId:  d.data().senderId,
        text:      d.data().text,
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
      })));
    });
  }, [convId]);

  return messages;
}

/**
 * Create a new conversation and send the first message.
 * Initiator is auto-added to acceptedBy; recipient must accept separately.
 */
export async function startDM(
  myUid: string,  myName: string,  myPhoto: string | null,
  otherUid: string, otherName: string, otherPhoto: string | null,
  text: string,
): Promise<string> {
  const id = mkDMId(myUid, otherUid);
  await setDoc(doc(db, 'directMessages', id), {
    participants:      [myUid, otherUid].sort(),
    participantNames:  { [myUid]: myName,  [otherUid]: otherName  },
    participantPhotos: { [myUid]: myPhoto ?? '', [otherUid]: otherPhoto ?? '' },
    initiatedBy:       myUid,
    acceptedBy:        [myUid],
    deletedBy:         [],
    lastMessage:       text,
    lastMessageAt:     serverTimestamp(),
    createdAt:         serverTimestamp(),
  }, { merge: true });

  await addDoc(collection(db, 'directMessages', id, 'messages'), {
    senderId:  myUid,
    text,
    createdAt: serverTimestamp(),
  });

  return id;
}

/** Send a message in an existing (accepted) conversation.
 * If the other party had deleted the conversation, clear deletedBy and
 * remove them from acceptedBy so it appears as a new Request for them.
 */
export async function sendDMMessage(convId: string, senderUid: string, text: string) {
  const snap = await getDoc(doc(db, 'directMessages', convId));
  const data = snap.exists() ? snap.data() : null;
  const deletedBy: string[] = data?.deletedBy ?? [];
  const othersWhoDeleted = deletedBy.filter(uid => uid !== senderUid);

  const update: Record<string, any> = {
    lastMessage:   text,
    lastMessageAt: serverTimestamp(),
    deletedBy:     [],
  };
  // Un-accept anyone who deleted so conversation becomes a Request for them
  for (const uid of othersWhoDeleted) {
    update.acceptedBy = arrayRemove(uid);
  }

  await updateDoc(doc(db, 'directMessages', convId), update);
  await addDoc(collection(db, 'directMessages', convId, 'messages'), {
    senderId:  senderUid,
    text,
    createdAt: serverTimestamp(),
  });
}

/** Recipient accepts a message request → both parties can now send freely */
export async function acceptDMRequest(convId: string, uid: string) {
  await updateDoc(doc(db, 'directMessages', convId), {
    acceptedBy: arrayUnion(uid),
  });
}

/** Hide a conversation from the deleter's inbox */
export async function deleteDMConv(convId: string, uid: string) {
  await updateDoc(doc(db, 'directMessages', convId), {
    deletedBy: arrayUnion(uid),
  });
}
