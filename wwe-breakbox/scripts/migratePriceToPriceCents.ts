/**
 * One-shot Firestore migration: rename `price` (number, dollars) to `priceCents` (integer cents).
 *
 * Touches:
 *   - events/{eventId}/slots/{slotId}.price        -> .priceCents = round(price * 100)
 *   - purchases/{captureId}.price                  -> .priceCents = round(price * 100)
 *   - events/{eventId}.price (if present)          -> .priceCents = round(price * 100)
 *
 * Idempotent: docs that already have `priceCents` are skipped.
 *
 * Usage (from repo root):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *     npx ts-node scripts/migratePriceToPriceCents.ts            # dry-run (default)
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *     npx ts-node scripts/migratePriceToPriceCents.ts --commit   # write changes
 *
 * Optional flags:
 *   --keep-price   Leave the legacy `price` field in place after writing `priceCents`.
 *                  Default: delete `price` once `priceCents` is written.
 */

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = new Set(process.argv.slice(2));
const COMMIT = args.has('--commit');
const KEEP_PRICE = args.has('--keep-price');

if (!getApps().length) {
  initializeApp({ credential: applicationDefault() });
}
const db = getFirestore();

interface Counters {
  scanned: number;
  converted: number;
  skipped: number;
  invalid: number;
}

function newCounters(): Counters {
  return { scanned: 0, converted: 0, skipped: 0, invalid: 0 };
}

function toCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

async function migrateCollection(label: string, collectionRefs: FirebaseFirestore.CollectionReference[]): Promise<Counters> {
  const counters = newCounters();
  for (const collectionRef of collectionRefs) {
    const snap = await collectionRef.get();
    for (const doc of snap.docs) {
      counters.scanned += 1;
      const data = doc.data();
      const hasNew = typeof data.priceCents === 'number';
      const hasOld = typeof data.price === 'number';

      if (hasNew && !hasOld) {
        counters.skipped += 1;
        continue;
      }

      if (hasNew && hasOld) {
        // Both present — drop the legacy field unless the operator opted to keep it.
        if (!KEEP_PRICE) {
          if (COMMIT) {
            await doc.ref.update({ price: FieldValue.delete() });
          }
          counters.converted += 1;
        } else {
          counters.skipped += 1;
        }
        continue;
      }

      if (!hasOld) {
        counters.skipped += 1;
        continue;
      }

      const cents = toCents(data.price);
      if (cents === null) {
        counters.invalid += 1;
        console.warn(`[${label}] ${doc.ref.path}: invalid price=${JSON.stringify(data.price)}, skipping`);
        continue;
      }

      const update: Record<string, unknown> = { priceCents: cents };
      if (!KEEP_PRICE) update.price = FieldValue.delete();

      if (COMMIT) {
        await doc.ref.update(update);
      } else {
        console.log(`[dry-run] [${label}] ${doc.ref.path}: price=${data.price} -> priceCents=${cents}${KEEP_PRICE ? '' : ' (delete price)'}`);
      }
      counters.converted += 1;
    }
  }
  return counters;
}

async function main(): Promise<void> {
  console.log(`Mode: ${COMMIT ? 'COMMIT (will write)' : 'DRY-RUN (no writes)'}`);
  console.log(`Legacy price field: ${KEEP_PRICE ? 'KEEP' : 'DELETE after migration'}`);
  console.log('');

  // Slots: events/{eventId}/slots/{slotId}
  const eventsSnap = await db.collection('events').get();
  const slotCollections = eventsSnap.docs.map((d) => d.ref.collection('slots'));

  const slotCounts = await migrateCollection('slot', slotCollections);
  const purchaseCounts = await migrateCollection('purchase', [db.collection('purchases')]);
  const eventCounts = await migrateCollection('event', [db.collection('events')]);

  const summary = (label: string, c: Counters) =>
    `  ${label}: scanned=${c.scanned} converted=${c.converted} skipped=${c.skipped} invalid=${c.invalid}`;

  console.log('\n--- Summary ---');
  console.log(summary('Slots', slotCounts));
  console.log(summary('Purchases', purchaseCounts));
  console.log(summary('Events', eventCounts));

  if (!COMMIT) {
    console.log('\nDry-run complete. Re-run with --commit to apply.');
  } else {
    console.log('\nMigration complete.');
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
