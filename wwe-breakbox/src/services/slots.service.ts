import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  DocumentData,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { firebaseDb } from '../config/firebase';
import { Slot } from '../types/slot.types';

function docToSlot(
  snap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>
): Slot {
  const data = snap.data() as any;
  return {
    id: snap.id,
    wrestlerName: data.wrestlerName,
    members: data.members ?? [],
    brand: data.brand,
    price: data.price,
    tier: data.tier,
    status: data.status,
    lockedBy: data.lockedBy ?? null,
    lockedAt: data.lockedAt?.toDate() ?? null,
    lockedUntil: data.lockedUntil?.toDate() ?? null,
    purchasedBy: data.purchasedBy ?? null,
    purchasedAt: data.purchasedAt?.toDate() ?? null,
    imageUrl: data.imageUrl ?? null,
  };
}

export function subscribeToSlots(
  eventId: string,
  callback: (slots: Slot[]) => void
): () => void {
  const slotsRef = collection(firebaseDb, 'events', eventId, 'slots');
  const slotsQuery = query(slotsRef, orderBy('wrestlerName', 'asc'));
  return onSnapshot(slotsQuery, (snapshot) => {
    callback(snapshot.docs.map(docToSlot));
  });
}

export function subscribeToSlot(
  eventId: string,
  slotId: string,
  callback: (slot: Slot | null) => void
): () => void {
  const slotRef = doc(firebaseDb, 'events', eventId, 'slots', slotId);
  return onSnapshot(slotRef, (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback(docToSlot(snap));
  });
}
