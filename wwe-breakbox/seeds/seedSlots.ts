/**
 * Seed script to populate Firestore with a breaking event and all 112 slots.
 *
 * Prerequisites:
 *   1. Place your Firebase service account JSON at seeds/serviceAccount.json
 *   2. Run: npx ts-node seeds/seedSlots.ts
 *
 * Optional: Pass --eventId=<id> to seed into an existing event document.
 * Optional: Pass --limit=<n> to seed only the top N slots by price.
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import { SLOTS_DATA } from '../src/constants/slots.data';
import { deriveTier } from '../src/utils/tier.utils';

// Initialize Admin SDK
const serviceAccountPath = path.join(__dirname, 'serviceAccount.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

const db = admin.firestore();

function generateSlotId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function seedEvent(): Promise<string> {
  // Check for --eventId arg
  const eventIdArg = process.argv.find((a) => a.startsWith('--eventId='));
  if (eventIdArg) {
    return eventIdArg.split('=')[1];
  }

  const eventId = db.collection('events').doc().id;
  const opensAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

  await db.collection('events').doc(eventId).set({
    title: 'WWE Topps Chrome 2026 Mega Break 3x',
    description: 'Pick your WWE superstar slot and claim your cards from the Mega Break!',
    status: 'upcoming',
    opensAt: admin.firestore.Timestamp.fromDate(opensAt),
    closesAt: null,
    imageUrl: null,
    totalSlots: getSlotsToSeed().length,
    soldSlots: 0,
    featuredSlotIds: [], // updated after slots are seeded
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Created event: ${eventId}`);
  return eventId;
}

function getSlotsToSeed(): typeof SLOTS_DATA {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  if (!limitArg) return SLOTS_DATA;
  const limit = parseInt(limitArg.split('=')[1], 10);
  return [...SLOTS_DATA].sort((a, b) => b.price - a.price).slice(0, limit);
}

async function seedSlots(eventId: string): Promise<string[]> {
  const slotsToSeed = getSlotsToSeed();
  const slotsRef = db.collection('events').doc(eventId).collection('slots');
  const slotIds: string[] = [];

  // Process in batches of 500 (Firestore batch limit)
  const batchSize = 400;
  for (let i = 0; i < slotsToSeed.length; i += batchSize) {
    const batch = db.batch();
    const chunk = slotsToSeed.slice(i, i + batchSize);

    for (const slotData of chunk) {
      const existing = await slotsRef.where('wrestlerName', '==', slotData.wrestlerName).limit(1).get();
      if (!existing.empty) {
        console.log(`Skipping existing slot: ${slotData.wrestlerName}`);
        slotIds.push(existing.docs[0].id);
        continue;
      }

      const slotId = generateSlotId();
      slotIds.push(slotId);
      batch.set(slotsRef.doc(slotId), {
        wrestlerName: slotData.wrestlerName,
        members: slotData.members,
        brand: slotData.brand,
        price: slotData.price,
        tier: deriveTier(slotData.price),
        status: 'available',
        lockedBy: null,
        lockedAt: null,
        lockedUntil: null,
        purchasedBy: null,
        purchasedAt: null,
        imageUrl: null,
      });
    }

    await batch.commit();
    console.log(`Seeded slots ${i + 1}–${Math.min(i + batchSize, slotsToSeed.length)}`);
  }

  return slotIds;
}

async function setFeaturedSlots(eventId: string, slotIds: string[]): Promise<void> {
  const slotsToSeed = getSlotsToSeed();
  const topSlots = slotsToSeed
    .map((slot, index) => ({ ...slot, id: slotIds[index] }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 8)
    .map((s) => s.id)
    .filter(Boolean);

  await db.collection('events').doc(eventId).update({
    featuredSlotIds: topSlots,
  });

  console.log(`Set ${topSlots.length} featured slots`);
}

async function seedUpcomingEvent(): Promise<{ eventId: string; slotCount: number }> {
  const eventId = db.collection('events').doc().id;
  const opensAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

  // Pick a small set of slots (top priced) so this seeded event stays cheap.
  const upcomingSlots = [...SLOTS_DATA]
    .sort((a, b) => b.price - a.price)
    .slice(0, 10);

  await db.collection('events').doc(eventId).set({
    title: "Next Week's Break",
    description: 'Upcoming WWE Topps Chrome break — queue up your slot now before it goes live.',
    status: 'upcoming',
    opensAt: admin.firestore.Timestamp.fromDate(opensAt),
    closesAt: null,
    imageUrl: null,
    totalSlots: upcomingSlots.length,
    soldSlots: 0,
    featuredSlotIds: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const slotsRef = db.collection('events').doc(eventId).collection('slots');
  const batch = db.batch();
  const slotIds: string[] = [];

  for (const slotData of upcomingSlots) {
    const slotId = generateSlotId();
    slotIds.push(slotId);
    batch.set(slotsRef.doc(slotId), {
      wrestlerName: slotData.wrestlerName,
      members: slotData.members,
      brand: slotData.brand,
      price: slotData.price,
      tier: deriveTier(slotData.price),
      status: 'available',
      lockedBy: null,
      lockedAt: null,
      lockedUntil: null,
      purchasedBy: null,
      purchasedAt: null,
      imageUrl: null,
    });
  }

  await batch.commit();

  await db.collection('events').doc(eventId).update({
    featuredSlotIds: slotIds.slice(0, 4),
  });

  console.log(`Created upcoming event: ${eventId} with ${slotIds.length} slots`);
  return { eventId, slotCount: slotIds.length };
}

async function main() {
  try {
    console.log('Starting seed...');
    const eventId = await seedEvent();
    const slotIds = await seedSlots(eventId);
    await setFeaturedSlots(eventId, slotIds);
    console.log(`\nSeed complete! Event ID: ${eventId}`);
    console.log(`Total slots seeded: ${slotIds.length}`);

    // Also seed a second, upcoming event so the Events page can surface it.
    const upcoming = await seedUpcomingEvent();
    console.log(`Upcoming event ID: ${upcoming.eventId} (${upcoming.slotCount} slots)`);

    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

main();
