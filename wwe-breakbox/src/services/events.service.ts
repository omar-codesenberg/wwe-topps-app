import {
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  DocumentData,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { firebaseDb } from '../config/firebase';
import { BreakEvent } from '../types/event.types';

function docToEvent(
  snap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>
): BreakEvent {
  const data = snap.data() as any;
  return {
    id: snap.id,
    title: data.title,
    description: data.description,
    status: data.status,
    opensAt: data.opensAt?.toDate() ?? new Date(),
    closesAt: data.closesAt?.toDate() ?? null,
    imageUrl: data.imageUrl ?? null,
    totalSlots: data.totalSlots ?? 0,
    soldSlots: data.soldSlots ?? 0,
    featuredSlotIds: data.featuredSlotIds ?? [],
    createdAt: data.createdAt?.toDate() ?? new Date(),
  };
}

export function subscribeToEvents(callback: (events: BreakEvent[]) => void): () => void {
  const q = query(collection(firebaseDb, 'events'), orderBy('opensAt', 'asc'));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map(docToEvent));
  });
}

export function subscribeToEvent(
  eventId: string,
  callback: (event: BreakEvent | null) => void
): () => void {
  const ref = doc(firebaseDb, 'events', eventId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback(docToEvent(snap));
  });
}
