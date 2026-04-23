import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDoc,
  getDocs,
  limit,
  startAfter,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { firebaseDb } from './firebase';
import type { BreakEvent, Slot, Purchase, UserProfile } from './types';

function tsToDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v?.toDate === 'function') return v.toDate();
  return null;
}

function docToEvent(snap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>): BreakEvent {
  const d = snap.data() as any;
  return {
    id: snap.id,
    title: d.title ?? '',
    description: d.description ?? '',
    status: d.status ?? 'upcoming',
    opensAt: tsToDate(d.opensAt) ?? new Date(),
    closesAt: tsToDate(d.closesAt),
    imageUrl: d.imageUrl ?? null,
    totalSlots: d.totalSlots ?? 0,
    soldSlots: d.soldSlots ?? 0,
    featuredSlotIds: d.featuredSlotIds ?? [],
    createdAt: tsToDate(d.createdAt) ?? new Date(),
  };
}

function docToSlot(snap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>): Slot {
  const d = snap.data() as any;
  return {
    id: snap.id,
    wrestlerName: d.wrestlerName,
    members: d.members ?? [],
    brand: d.brand,
    price: d.price,
    tier: d.tier,
    status: d.status,
    lockedBy: d.lockedBy ?? null,
    lockedAt: tsToDate(d.lockedAt),
    lockedUntil: tsToDate(d.lockedUntil),
    purchasedBy: d.purchasedBy ?? null,
    purchasedAt: tsToDate(d.purchasedAt),
    imageUrl: d.imageUrl ?? null,
  };
}

function docToPurchase(snap: QueryDocumentSnapshot<DocumentData>): Purchase {
  const d = snap.data() as any;
  return {
    id: snap.id,
    userId: d.userId,
    eventId: d.eventId,
    slotId: d.slotId,
    wrestlerName: d.wrestlerName,
    eventTitle: d.eventTitle,
    brand: d.brand,
    tier: d.tier,
    price: d.price,
    purchasedAt: tsToDate(d.purchasedAt) ?? new Date(),
    transactionId: d.transactionId,
    status: d.status,
  };
}

function docToUser(snap: DocumentSnapshot<DocumentData>): UserProfile | null {
  if (!snap.exists()) return null;
  const d = snap.data() as any;
  return {
    uid: snap.id,
    email: d.email ?? null,
    displayName: d.displayName ?? '',
    firstName: d.firstName ?? '',
    lastName: d.lastName ?? '',
    username: d.username ?? '',
    shippingAddress: d.shippingAddress ?? null,
    wantBaseCards: d.wantBaseCards ?? false,
    legacyUser: d.legacyUser ?? false,
    balance: d.balance ?? 0,
    purchaseCount: d.purchaseCount ?? 0,
    fcmToken: d.fcmToken ?? null,
    createdAt: tsToDate(d.createdAt),
  };
}

export function subscribeToEvents(cb: (events: BreakEvent[]) => void) {
  const q = query(collection(firebaseDb, 'events'), orderBy('opensAt', 'desc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map(docToEvent)));
}

export function subscribeToEvent(eventId: string, cb: (event: BreakEvent | null) => void) {
  const ref = doc(firebaseDb, 'events', eventId);
  return onSnapshot(ref, (snap) => cb(snap.exists() ? docToEvent(snap) : null));
}

export function subscribeToSlots(eventId: string, cb: (slots: Slot[]) => void) {
  const q = query(collection(firebaseDb, 'events', eventId, 'slots'), orderBy('price', 'desc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map(docToSlot)));
}

export function subscribeToEventPurchases(eventId: string, cb: (purchases: Purchase[]) => void) {
  const q = query(
    collection(firebaseDb, 'purchases'),
    where('eventId', '==', eventId),
    orderBy('purchasedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map(docToPurchase)),
    (err) => console.error('[subscribeToEventPurchases] failed:', err)
  );
}

export function subscribeToUserPurchases(uid: string, cb: (purchases: Purchase[]) => void) {
  const q = query(
    collection(firebaseDb, 'purchases'),
    where('userId', '==', uid),
    orderBy('purchasedAt', 'desc')
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map(docToPurchase)));
}

export async function fetchUser(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(firebaseDb, 'users', uid));
  return docToUser(snap);
}

export function subscribeToUser(uid: string, cb: (user: UserProfile | null) => void) {
  const ref = doc(firebaseDb, 'users', uid);
  return onSnapshot(ref, (snap) => cb(docToUser(snap)));
}

export interface UsersPage {
  users: UserProfile[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/**
 * Paginated fetch of the users collection, ordered by createdAt desc.
 * Pass `after` = the last QueryDocumentSnapshot of the previous page to get the next page.
 * Fetches `pageSize + 1` docs to detect whether more pages exist.
 */
export async function fetchUsersPage(
  pageSize: number,
  after: QueryDocumentSnapshot<DocumentData> | null
): Promise<UsersPage> {
  const parts: any[] = [
    collection(firebaseDb, 'users'),
    orderBy('createdAt', 'desc'),
  ];
  if (after) parts.push(startAfter(after));
  parts.push(limit(pageSize + 1));
  // @ts-expect-error — query signature accepts a variadic list of constraints
  const q = query(...parts);
  const snap = await getDocs(q);
  const docs = snap.docs;
  const hasMore = docs.length > pageSize;
  const pageDocs = docs.slice(0, pageSize);
  const users = pageDocs
    .map((d) => docToUser(d))
    .filter((u): u is UserProfile => u !== null);
  return {
    users,
    lastDoc: pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null,
    hasMore,
  };
}
