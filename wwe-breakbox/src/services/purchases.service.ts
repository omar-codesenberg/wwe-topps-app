import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { firebaseDb } from '../config/firebase';
import { Purchase } from '../types/purchase.types';

// Must match the request.query.limit bound in firestore.rules for /purchases list.
const PURCHASES_LIST_LIMIT = 1000;

function docToPurchase(snap: QueryDocumentSnapshot<DocumentData>): Purchase {
  const data = snap.data() as any;
  return {
    id: snap.id,
    userId: data.userId,
    eventId: data.eventId,
    slotId: data.slotId,
    wrestlerName: data.wrestlerName,
    eventTitle: data.eventTitle,
    brand: data.brand,
    tier: data.tier,
    price: data.price,
    purchasedAt: data.purchasedAt?.toDate() ?? new Date(),
    transactionId: data.transactionId,
    status: data.status,
  };
}

export function subscribeToPurchases(
  userId: string,
  callback: (purchases: Purchase[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(firebaseDb, 'purchases'),
    where('userId', '==', userId),
    orderBy('purchasedAt', 'desc'),
    limit(PURCHASES_LIST_LIMIT)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      callback(snapshot.docs.map(docToPurchase));
    },
    (err) => {
      console.error('[subscribeToPurchases] failed:', err);
      onError?.(err);
    }
  );
}
