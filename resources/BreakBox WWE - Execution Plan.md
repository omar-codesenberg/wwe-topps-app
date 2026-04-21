# BreakBox WWE — Execution Plan

## Context

This plan covers building a mobile app called **BreakBox WWE** — a slot-picking app for WWE trading card breaking events. In a "break," a host opens sealed packs live on stream and participants buy slots tied to specific wrestlers/groups; they receive whatever cards from that wrestler get pulled. The app handles the full lifecycle: event scheduling, real-time slot availability, 30-second atomic slot reservation, fake checkout (future PayPal), and purchase history.

**Scale**: 50–100 concurrent users per event. **Budget**: cheapest viable solution.

---

## Architecture & Reasoning

### Frontend: React Native + Expo (Managed Workflow)

Single codebase for iOS and Android. The managed workflow eliminates native build toolchain complexity and supports OTA updates (via Expo Updates) to bypass App Store review cycles for minor fixes. `expo-dev-client` is required (instead of Expo Go) because `@react-native-firebase` uses native modules.

### Backend: Firebase (Google)

The cheapest real-time backend for this scale. No server to manage. Firestore real-time listeners push slot status changes to all clients automatically — no polling.

- **Firebase Auth** — Email/password auth (free: 10K users/month)
- **Firestore** — Real-time slot state + event data (free: 50K reads/day, 20K writes/day)
- **Cloud Functions** — Atomic slot locking via Firestore transactions (free: 2M invocations/month)
- **Cloud Scheduler** — Releases expired locks every 60s (free: 3 jobs)
- **Firebase Cloud Messaging** — Push notifications for event start (free)

**Why not a custom server?** A Node.js server on Railway/Render would cost $5–7/month and requires managing uptime. Firebase handles all of that with a better free tier for this traffic pattern.

**Cost estimate**: ~$0–1/month (Blaze plan required for Cloud Functions, but charges only trigger above free tier thresholds).

### Real-Time Slot Locking Design

The critical requirement is preventing two users from reserving the same slot. The solution:

1. Cloud Function `lockSlot` uses a **Firestore transaction** (serialized read-then-write) — if two users call it simultaneously, only one succeeds.
2. Lock includes a `lockedUntil` server timestamp (now + 30s).
3. A scheduled Cloud Function (`releaseExpiredLocks`, every 60s) queries all locked slots past their `lockedUntil` and resets them.
4. Client uses the server-provided `lockedUntil` timestamp (not a local timer) for the countdown, ensuring accuracy.

---

## Slot Data (from spreadsheet)

112 slots from `WWE Topps Chrome 2026 Mega 3x Break.xlsx`:
- Column A: Wrestler/group name
- Column B: Price in dollars (1–10,000)
- **Tier derivation**: Gold = price ≥ 5000, Silver = price ≥ 1000, Bronze = price ≥ 1
- **Brand assignment**: Must be done manually during seeding (RAW, SMACKDOWN, NXT, LEGENDS)

---

## Design Theme (from `Gemini_Generated_Image_i1rl1hi1rl1hi1rl.png`)

Three core screens shown in the mockup:
1. **Home / Event Hub**: Dark background, countdown timer, "ENTER THE ARENA" CTA, horizontal "TOP CONTENDERS" scroll
2. **Listings / The Roster**: SectionList grouped by brand, status badges (LIVE/CLAIMED/LOCKED), "BUY SPOT" buttons
3. **Checkout / The Main Event**: Slot card, 30s circular countdown, fake PayPal button

**Color palette:**
- Background: `#0A0A0A`
- Primary red: `#CC0000`
- Gold: `#FFD700`
- Text: `#FFFFFF` / `#AAAAAA`
- Glass card bg: `rgba(255,255,255,0.08)`
- Brand accents: RAW=red, SmackDown=`#0057B8`, NXT=gold, Legends=`#6B21A8`

---

## Data Model (Firestore)

```
/events/{eventId}
  title, description, status ("upcoming"|"live"|"closed")
  opensAt: Timestamp, closesAt: Timestamp|null
  totalSlots: 112, soldSlots: number  ← denormalized counter
  featuredSlotIds: string[]           ← curated for Home "Top Contenders"

/events/{eventId}/slots/{slotId}
  wrestlerName: string
  members: string[]          ← group member names
  brand: "RAW"|"SMACKDOWN"|"NXT"|"LEGENDS"
  price: number (1–10000)
  tier: "Gold"|"Silver"|"Bronze"
  status: "available"|"locked"|"sold"
  lockedBy: userId|null
  lockedAt: Timestamp|null
  lockedUntil: Timestamp|null  ← lockedAt + 30s
  purchasedBy: userId|null
  purchasedAt: Timestamp|null

/users/{userId}
  email, displayName, createdAt, fcmToken|null

/purchases/{purchaseId}
  userId, eventId, slotId, wrestlerName, eventTitle, brand, tier
  price, purchasedAt, transactionId (fake UUID), status: "completed"
```

**Security rules**: Only Cloud Functions (Admin SDK) can write slots and purchases. Clients read-only on events/slots, read-own on purchases.

---

## Cloud Functions

| Function | Trigger | Purpose |
|---|---|---|
| `lockSlot(eventId, slotId)` | HTTPS Callable | Firestore transaction: check available → set locked, return `lockedUntil` |
| `purchaseSlot(eventId, slotId)` | HTTPS Callable | Verify lock owner + expiry → set sold, create purchase doc, increment counters |
| `releaseSlotOnCancel(eventId, slotId)` | HTTPS Callable | User navigates away → release their own lock |
| `releaseExpiredLocks` | Cloud Scheduler (60s) | Collection group query: locked slots past `lockedUntil` → reset to available |

Requires Firestore composite index: `slots` collection group, `(status ASC, lockedUntil ASC)`.

Set `minInstances: 1` on `lockSlot` and `purchaseSlot` in production to eliminate cold-start latency (~1–3s) on time-sensitive lock operations (~$0.50/month).

---

## Project Folder Structure

```
/wwe-breakbox/
├── app.json                     # Expo config (bundleId, google-services paths)
├── App.tsx                      # Root: NavigationContainer + QueryClient + providers
├── eas.json                     # EAS Build profiles (dev/preview/production)
├── firestore.rules
├── firestore.indexes.json
│
├── /src
│   ├── /config/firebase.ts      # RNFirebase init, export auth/db/functions refs
│   ├── /navigation/
│   │   ├── RootNavigator.tsx    # Auth gate → AuthStack vs MainTabs
│   │   ├── AuthStack.tsx
│   │   ├── MainTabs.tsx         # Tab: Events | My Purchases
│   │   └── EventsStack.tsx      # EventsList → EventDetail → SlotsRoster → Checkout
│   ├── /screens/
│   │   ├── /auth/               # SplashScreen, LoginScreen, RegisterScreen
│   │   ├── /events/             # EventsListScreen, EventDetailScreen, SlotsRosterScreen, CheckoutScreen
│   │   └── /purchases/          # MyPurchasesScreen
│   ├── /components/
│   │   ├── /ui/                 # GlassCard, TierBadge, StatusBadge, CountdownTimer, WWEButton
│   │   ├── /slots/              # SlotCard, SlotGrid, FeaturedSlotCard, LockCountdown
│   │   └── /events/             # EventCard, EventCountdown
│   ├── /hooks/
│   │   ├── useAuth.ts           # onAuthStateChanged → Zustand
│   │   ├── useEvent.ts          # Single event real-time listener
│   │   ├── useSlots.ts          # Slots subcollection listener, groups by brand
│   │   ├── useSlotLock.ts       # Lock state machine (idle→locking→locked→expired)
│   │   ├── usePurchases.ts      # User's purchase history
│   │   └── useCountdown.ts      # Generic countdown from target Date
│   ├── /store/
│   │   ├── authStore.ts         # Zustand: { user, isLoading }
│   │   ├── checkoutStore.ts     # Zustand: { selectedSlot, lockData }
│   │   └── toastStore.ts        # Zustand: global toast messages
│   ├── /services/
│   │   ├── auth.service.ts
│   │   ├── events.service.ts
│   │   ├── slots.service.ts
│   │   └── functions.service.ts # lockSlot, purchaseSlot, releaseSlotOnCancel wrappers
│   ├── /types/                  # event.types.ts, slot.types.ts, purchase.types.ts
│   ├── /constants/
│   │   ├── theme.ts             # Full color/typography/spacing system
│   │   ├── brands.ts            # Brand enum + accent colors
│   │   └── slots.data.ts        # All 112 slots as TS array (seed source + static ref)
│   └── /utils/                  # tier.utils.ts, time.utils.ts, uuid.utils.ts
│
├── /functions/src/              # Firebase Cloud Functions (separate Node project)
│   ├── index.ts                 # Export all functions
│   ├── lockSlot.ts
│   ├── purchaseSlot.ts
│   ├── releaseExpiredLocks.ts
│   ├── releaseSlotOnCancel.ts
│   └── /utils/admin.ts          # Admin SDK init
│
└── /seeds/seedSlots.ts          # One-time Node script: writes all 112 slots to Firestore
```

---

## Implementation Phases

### Phase 0: Project Setup (1–2 days)
- `npx create-expo-app wwe-breakbox --template expo-template-blank-typescript`
- Install `expo-dev-client` (required for RNFirebase native modules)
- Install all dependencies (see below)
- Create Firebase project "breakbox-wwe", enable Auth + Firestore + Functions (Blaze plan)
- Download `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) into project root
- Configure `app.json` with Firebase config plugin and `bundleIdentifier: com.breakbox.wwe`
- Add `react-native-reanimated` plugin to `babel.config.js`
- Initialize `/functions` with `firebase init functions --typescript`
- Run `eas build:configure` to create `eas.json`
- Create `/src/constants/theme.ts` with the full color palette

### Phase 1: Auth Flow (2 days)
- `authStore.ts`: Zustand `{ user, isLoading }`
- `auth.service.ts`: wrap RNFirebase Auth methods
- `useAuth.ts`: `onAuthStateChanged` → updates store, creates `/users/{uid}` doc on first sign-in
- `RootNavigator.tsx`: AuthStack when no user, MainTabs when authenticated
- `SplashScreen`, `LoginScreen`, `RegisterScreen` — dark glass-card style

**Note**: Do not persist auth manually. RNFirebase Auth handles native persistence; `onAuthStateChanged` fires on boot with the stored user. `isLoading` starts `true`, flips to `false` after first emission.

### Phase 2: Data Seeding (1 day)
- Create `/src/constants/slots.data.ts` — all 112 slots as a TS array with brand assignment (manual editorial step: assign each wrestler to RAW/SMACKDOWN/NXT/LEGENDS)
- Create `/seeds/seedSlots.ts` — Admin SDK script, creates event doc + 112 slot subdocs, idempotent
- Manually set `featuredSlotIds` on the event doc (5–8 highest-priced slots)
- Add service account JSON to `.gitignore`

### Phase 3: Real-Time Slot Browsing (3 days)
- `events.service.ts` + `slots.service.ts`: Firestore `onSnapshot` listeners
- `useEvent(eventId)`, `useSlots(eventId)`: hooks with cleanup on unmount
- `useSlots` groups slots by brand client-side
- **EventsListScreen**: branding, countdown timer, "ENTER THE ARENA" CTA, TOP CONTENDERS horizontal scroll
- **SlotsRosterScreen**: `SectionList` with 4 brand sections, renders `SlotCard` per slot
- `SlotCard`: wrestler name, members, price, `TierBadge`, `StatusBadge`, "BUY SPOT" button
- Status visuals: available (full opacity, red button), locked (amber badge, semi-transparent), sold (grey overlay, "CLAIMED")
- `GlassCard`: `expo-blur` `BlurView` + semi-transparent border — reused throughout

### Phase 4: Slot Locking + 30-Second Timer (3 days)
- Deploy all 4 Cloud Functions to Firebase
- `functions.service.ts`: typed HTTPS callable wrappers
- `useSlotLock.ts`: state machine `"idle" → "locking" → "locked" → "expired" | "error"`
- `useCountdown.ts`: takes `targetDate: Date` from server's `lockedUntil`, `setInterval` every 100ms
- **CheckoutScreen**: slot details, `LockCountdown` circular timer, cancel button, fake PayPal button
- `LockCountdown`: Reanimated arc, color transitions green → amber → red
- Cancel / navigate-away: intercept `beforeRemove` event, call `releaseSlotOnCancel`, then allow navigation
- SlotCard "BUY SPOT" → calls `lockSlot` → on success navigate to Checkout with `lockedUntil`; on failure show toast

**Race condition note**: Two simultaneous `lockSlot` calls serialize in Firestore transaction — one wins, one receives `SLOT_LOCKED`. Real-time listener updates the losing user's UI within ~1s.

### Phase 5: Fake Checkout + Purchases (2 days)
- Deploy `purchaseSlot` Cloud Function
- PayPal button is cosmetic only — calls `purchaseSlot` directly with `// TODO: Replace with PayPal SDK`
- Loading overlay during purchase prevents double-taps
- On success: navigate to `PurchaseSuccessScreen` ("YOU CLAIMED IT!", confetti, wrestler name/tier/price)
- Clear `checkoutStore` on success and cancel

### Phase 6: My Purchases Screen (1 day)
- `usePurchases.ts`: query `/purchases` where `userId == auth.uid`, ordered by `purchasedAt` desc
- **MyPurchasesScreen**: FlatList of `PurchaseHistoryCard` components (glass card style)
- Shows: wrestler name, event title, brand, tier badge, price paid, date
- Empty state: "No purchases yet. Enter the Arena!" with Events tab link

### Phase 7: Polish (2–3 days)
- Load `Oswald` or `Bebas Neue` font via `@expo-google-fonts/oswald` for headers
- Slot status change animations: amber pulse on lock, grey overlay slide-in on sold (Reanimated)
- Home countdown transitions to "🔴 LIVE NOW" pulsing badge when event goes live
- "Enter the Arena" button: glowing red Reanimated `withRepeat` animation when live, dimmed when upcoming
- Brand section headers: accent color left border + tint
- Global toast system (Zustand `toastStore`, auto-dismiss 3s, dark-themed)
- `KeyboardAvoidingView` on Login/Register screens
- Custom modal transition for CheckoutScreen

### Phase 8: Testing & Deployment Prep (2–3 days)
- Manual test matrix: auth persistence, simultaneous slot lock race condition (two devices), lock expiry, full purchase flow, cancel flow
- Firebase emulator suite for security rules unit tests (`@firebase/rules-unit-testing`)
- EAS Build: `eas build --platform all --profile preview` for TestFlight + Play Store internal testing
- Store Firebase config in EAS Secrets (not `.env` committed to repo)
- Deploy Firestore composite index (`firestore.indexes.json`)
- Set `minInstances: 1` on `lockSlot` + `purchaseSlot` in production

---

## Key Dependencies

```bash
# Expo
npx expo install expo-dev-client expo-linear-gradient expo-blur expo-notifications \
  expo-font expo-splash-screen expo-constants

# Navigation
npx expo install @react-navigation/native @react-navigation/stack \
  @react-navigation/bottom-tabs react-native-screens react-native-safe-area-context \
  react-native-gesture-handler

# Firebase
npx expo install @react-native-firebase/app @react-native-firebase/auth \
  @react-native-firebase/firestore @react-native-firebase/functions

# Animation & State
npx expo install react-native-reanimated
npm install zustand @tanstack/react-query date-fns

# Fonts
npx expo install @expo-google-fonts/oswald expo-font
```

---

## Cost Summary

| Service | Free Tier | Monthly Cost |
|---|---|---|
| Firebase Auth | 10K users/mo | $0 |
| Firestore reads/writes | 50K reads, 20K writes/day | $0 |
| Cloud Functions | 2M invocations/mo | $0 |
| Cloud Scheduler | 3 free jobs | $0 |
| Functions min instances (prod) | — | ~$1/mo |
| EAS Build | 30 builds/mo free | $0 |
| Apple Developer Program | — | $99/yr |
| Google Play (one-time) | — | $25 |
| **Monthly recurring** | | **~$1/month** |

---

## Verification Checklist

- [ ] Two devices tap "BUY SPOT" simultaneously → only one locks, the other sees toast error
- [ ] Lock a slot, wait without purchasing → slot returns to available within 60s on both devices
- [ ] Complete purchase → appears in My Purchases, slot shows CLAIMED in roster for all users
- [ ] Navigate back from Checkout → slot released, available again in roster
- [ ] Event closes → all slots show CLAIMED, "ENTER THE ARENA" disabled
- [ ] Sign out and restart app → auth persists, no re-login needed
- [ ] Security rules: attempt to write a slot directly from client → blocked

---

## Critical Files

| File | Why Critical |
|---|---|
| `/functions/src/lockSlot.ts` | Firestore transaction preventing race conditions — the entire product guarantee |
| `/functions/src/releaseExpiredLocks.ts` | Requires composite index; correctness determines lock expiry reliability |
| `/src/hooks/useSlotLock.ts` | Core client state machine; handles lock, countdown, expiry, cancel cleanup |
| `/src/screens/events/CheckoutScreen.tsx` | Orchestrates timer, cancel interception, fake payment, navigation |
| `/src/constants/slots.data.ts` | Authoritative source for all 112 slots; drives seed script and UI |

---

## Claude Agent Execution Strategy

The build is organized into **5 parallel waves**. Within each wave, agents work simultaneously. No agent in wave N starts until all agents in wave N-1 are complete. The orchestrating agent (you) launches all agents in a wave in a single message as parallel tool calls, waits for all to finish, then launches the next wave.

### Dependency Graph

```
Wave 1: Project Scaffold
    ├── Agent A: Expo init + folder structure + theme
    └── Agent B: Firebase config files + Functions project scaffold
           ↓
Wave 2: Core Modules (all independent of each other)
    ├── Agent A: Auth flow (screens + hooks + store)
    ├── Agent B: slots.data.ts (all 112 slots) + seed script
    └── Agent C: Cloud Functions implementation (all 4 functions)
           ↓
Wave 3: Real-Time Layer (depends on Wave 2 B + C)
    ├── Agent A: Browsing screens (EventsListScreen, SlotsRosterScreen, all slot/event components)
    ├── Agent B: Core hooks (useSlots, useEvent, useSlotLock state machine, useCountdown)
    └── Agent C: Firestore security rules + composite indexes
           ↓
Wave 4: Transaction Layer (depends on Wave 3 A + B)
    ├── Agent A: CheckoutScreen + LockCountdown component
    ├── Agent B: MyPurchasesScreen + PurchaseSuccessScreen + usePurchases hook
    └── Agent C: Global toast system + error handling throughout app
           ↓
Wave 5: Polish + Deployment (depends on Wave 4)
    ├── Agent A: Animations (Reanimated status transitions, glow effects, LIVE pulse)
    ├── Agent B: Typography + visual polish (fonts, brand headers, glassmorphism refinement)
    └── Agent C: EAS Build config + environment config + deployment prep
```

---

### Wave 1 — Project Scaffold

**Launch both agents in a single message (parallel).**

#### Agent A: Expo App Scaffold
```
Task: Initialize the Expo project and create the complete folder structure with placeholder files.

1. Run: npx create-expo-app wwe-breakbox --template expo-template-blank-typescript
2. Install all dependencies listed in the "Key Dependencies" section of the plan
3. Create every folder listed in the folder structure section
4. Create placeholder index files for each folder (e.g., /src/screens/auth/index.ts exporting nothing yet)
5. Create /src/constants/theme.ts with the full color palette:
   BACKGROUND: '#0A0A0A', RED: '#CC0000', GOLD: '#FFD700',
   TEXT_PRIMARY: '#FFFFFF', TEXT_SECONDARY: '#AAAAAA',
   GLASS_BG: 'rgba(255,255,255,0.08)', GLASS_BORDER: 'rgba(255,255,255,0.15)'
6. Create /src/constants/brands.ts with RAW/SMACKDOWN/NXT/LEGENDS enum + accent colors
7. Configure babel.config.js with react-native-reanimated plugin
8. Configure app.json with bundleIdentifier: com.breakbox.wwe, expo-dev-client, RNFirebase config plugin placeholders
9. Create App.tsx root with NavigationContainer + QueryClientProvider + empty MainTabs placeholder
10. Run eas build:configure to generate eas.json

Do NOT implement any business logic yet. Just scaffold.
```

#### Agent B: Firebase + Functions Scaffold
```
Task: Create the Firebase Functions project structure and all config files.

1. In /functions: run firebase init functions --typescript
2. Create /functions/src/utils/admin.ts — initialize Firebase Admin SDK, export db and auth
3. Create /functions/src/index.ts — export stubs for: lockSlot, purchaseSlot, releaseSlotOnCancel, releaseExpiredLocks
4. Create stub files for each function (return { success: true } for now)
5. Create firestore.rules with the security rules defined in the plan
6. Create firestore.indexes.json with the composite index: collection group "slots", fields: status ASC + lockedUntil ASC
7. Create .env.example at project root listing all required Firebase config env vars
8. Create /seeds/ directory with a seedSlots.ts stub that imports the Admin SDK
9. Create /src/config/firebase.ts — RNFirebase init that exports typed auth, db, functions instances

Do NOT implement any function logic yet. Just structure and stubs.
```

---

### Wave 2 — Core Modules

**Launch all three agents in a single message (parallel). All are independent.**

#### Agent A: Auth Flow
```
Task: Implement the complete authentication flow.

Context:
- Theme colors are in /src/constants/theme.ts
- RNFirebase auth is initialized in /src/config/firebase.ts
- Folder structure exists at /src/store/, /src/hooks/, /src/services/, /src/screens/auth/

Implement:
1. /src/store/authStore.ts — Zustand store: { user: FirebaseAuthTypes.User|null, isLoading: boolean, setUser, setLoading }
2. /src/services/auth.service.ts — wrap RNFirebase: signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
3. /src/hooks/useAuth.ts — calls firebase.auth().onAuthStateChanged(), updates authStore, creates /users/{uid} Firestore doc on first sign-in (check for createdAt field absence)
4. /src/navigation/RootNavigator.tsx — reads authStore; shows AuthStack if no user, MainTabs if authenticated, SplashScreen while isLoading=true
5. /src/navigation/AuthStack.tsx — Splash → Login → Register
6. /src/screens/auth/SplashScreen.tsx — full dark background, "BREAKBOX WWE" title, expo-splash-screen integration
7. /src/screens/auth/LoginScreen.tsx — email + password inputs, WWE-themed glass card style (use theme constants), error display, link to Register
8. /src/screens/auth/RegisterScreen.tsx — email + password + displayName, calls createUserWithEmailAndPassword + updateProfile
9. /src/components/ui/WWEButton.tsx — reusable button: red fill for primary, outlined for secondary, takes label + onPress + disabled + loading props
10. /src/components/ui/GlassCard.tsx — BlurView (expo-blur) with GLASS_BG background + GLASS_BORDER border

Key note: isLoading starts true, flips false after first onAuthStateChanged emission. Do not use AsyncStorage manually — RNFirebase handles auth persistence natively.
```

#### Agent B: Slot Data + Seed Script
```
Task: Create the authoritative 112-slot data file and seeding script.

1. Create /src/constants/slots.data.ts as a TypeScript array of 112 objects.
   Each object shape: { wrestlerName: string, members: string[], price: number, brand: "RAW"|"SMACKDOWN"|"NXT"|"LEGENDS" }

   Here are ALL 112 entries from the spreadsheet with their prices (Column B) and brand assignments:

   RAW brand:
   - AJ Lee, price: 9, members: []
   - AJ Styles, price: 4, members: []
   - Alexa Bliss, price: 12, members: []
   - Asuka & Kairi Sane, price: 8, members: ["Asuka", "Kairi Sane"]
   - Becky Lynch, price: 10, members: []
   - Bianca Belair w/Street Profits, price: 7, members: ["Bianca Belair", "Angelo Dawkins", "Montez Ford"]
   - Bray Wyatt, price: 6, members: []
   - Carmelo Hayes, price: 5, members: []
   - Damian Priest & Ron Killings, price: 4, members: ["Damian Priest", "Ron Killings"]
   - Dominik Mysterio, price: 3, members: []
   - Drew McIntyre, price: 6, members: []
   - Fatal Influence, price: 5, members: []
   - Finn Bálor, price: 7, members: []
   - Ilja Dragunov & Tyler Bates & Pete Dunne, price: 5, members: ["Ilja Dragunov", "Tyler Bates", "Pete Dunne"]
   - Judgement Day, price: 8, members: []
   - Kevin Owens, price: 7, members: []
   - LA Knight, price: 8, members: []
   - Liv Morgan & Racquel Rodriguez, price: 6, members: ["Liv Morgan", "Racquel Rodriguez"]
   - Ludwig Kaiser, price: 3, members: []
   - Lyra Valkyria, price: 5, members: []
   - Naomi, price: 4, members: []
   - Nia Jax & Lash Legend & Candice LeRae, price: 5, members: ["Nia Jax", "Lash Legend", "Candice LeRae"]
   - Penta, price: 6, members: []
   - Randy Orton & Batista, price: 9, members: ["Randy Orton", "Batista"]
   - Rey Fenix, price: 5, members: []
   - Rhea Ripley, price: 12, members: []
   - Sami Zayn, price: 7, members: []
   - Seth Rollins, price: 11, members: []
   - Sheamus, price: 4, members: []

   SMACKDOWN brand:
   - Aleister Black & Zelina Vega, price: 3, members: ["Aleister Black", "Zelina Vega"]
   - Bayley, price: 9, members: []
   - Charlotte Flair, price: 11, members: []
   - Chelsea Green & Alba Fyre, price: 4, members: ["Chelsea Green", "Alba Fyre"]
   - CM Punk, price: 13, members: []
   - Ethan Page, price: 3, members: []
   - Giulia, price: 7, members: []
   - Gunther, price: 12, members: []
   - Iyo Sky, price: 8, members: []
   - Jacob Fatu, price: 8, members: []
   - Jade Cargill & B-Fab & Michin, price: 6, members: ["Jade Cargill", "B-Fab", "Michin"]
   - Joe Hendry, price: 5, members: []
   - Jordynne Grace, price: 5, members: []
   - Karmen Petrovic, price: 3, members: []
   - Kelani Jordan, price: 4, members: []
   - Kiana James, price: 3, members: []
   - Lola Vice, price: 4, members: []
   - LWO, price: 4, members: []
   - MCMG, price: 5, members: []
   - MFT, price: 3, members: []
   - Oba Femi, price: 6, members: []
   - OTM, price: 4, members: []
   - Piper Niven, price: 3, members: []
   - Pretty Deadly, price: 4, members: []
   - Ricky Saints, price: 3, members: []
   - Roman Reigns, price: 15, members: []
   - Rusev, price: 4, members: []
   - Shinsuke Nakamura, price: 5, members: []
   - Sol Ruca, price: 4, members: []
   - Stephanie Vaquer, price: 6, members: []
   - Tatum Paxley, price: 4, members: []
   - The American Nightmare Cody Rhodes, price: 14, members: []
   - The Family, price: 12, members: ["Roman Reigns", "Solo Sikoa", "Sami Zayn"]
   - The Rock, price: 15, members: []
   - The Vision, price: 5, members: []
   - Thea Hail, price: 3, members: []
   - Tiffany Stratton, price: 9, members: []
   - Wyatt Sicks, price: 6, members: []

   NXT brand:
   - American Alpha (Chad Gable, Brutus Creed, Julius Creed, Ivey Nile), price: 3, members: ["Chad Gable", "Brutus Creed", "Julius Creed", "Ivey Nile"]
   - American Alpha (Maxxine Dupri, Akira Tozawa, Otis), price: 3, members: ["Maxxine Dupri", "Akira Tozawa", "Otis"]
   - BirthRight Stable, price: 4, members: []
   - Blake Monroe, price: 3, members: []
   - Brinley Reece & Carlee Bright, price: 3, members: ["Brinley Reece", "Carlee Bright"]
   - Dark Stable, price: 4, members: []
   - DIY, price: 5, members: []
   - Fraxiom, price: 5, members: []
   - Izzi Dame, price: 3, members: []
   - Je'Von Evans, price: 4, members: []
   - Lilian Garcia, price: 3, members: []
   - NXT (19 wrestlers), price: 6, members: []
   - Nikkita Lyons, price: 3, members: []
   - Trick Williams, price: 7, members: []
   - War Raiders, price: 4, members: []
   - Wendy Choo, price: 3, members: []
   - Wren Sinclair, price: 3, members: []
   - Zaria, price: 3, members: []
   - Zoey Stark, price: 4, members: []

   LEGENDS brand:
   - Bret Hart & Natalya, price: 7, members: ["Bret Hart", "Natalya"]
   - Brock Lesnar, price: 11, members: []
   - DX, price: 10, members: []
   - ECW, price: 6, members: []
   - Hillbilly Jim, price: 2, members: []
   - Hulk Hogan, price: 13, members: []
   - John Cena, price: 15, members: []
   - Jey Uso & Jimmy Uso & Rikishi, price: 7, members: ["Jey Uso", "Jimmy Uso", "Rikishi"]
   - Kane, price: 9, members: []
   - Kurt Angle & JBL, price: 6, members: ["Kurt Angle", "JBL"]
   - LGDF, price: 5, members: []
   - Legends, price: 8, members: []
   - Lita & Victoria, price: 7, members: ["Lita", "Victoria"]
   - Mark Henry, price: 5, members: []
   - Mick Foley, price: 8, members: []
   - New Day, price: 6, members: []
   - Nikki Bella, price: 6, members: []
   - Shawn Michaels, price: 11, members: []
   - Stacy Keibler, price: 7, members: []
   - Stone Cold Steve Austin, price: 14, members: []
   - The Miz & Maryse, price: 5, members: ["The Miz", "Maryse"]
   - Torrie Wilson, price: 6, members: []
   - Triple H, price: 12, members: []
   - Trish Stratus, price: 10, members: []
   - Undertaker, price: 14, members: []
   - WCW, price: 5, members: []

   NOTE: The price range in the app supports 1–10,000 (not limited to the spreadsheet values above). These are just the initial event's prices. Tier derivation: Gold ≥ 5000, Silver ≥ 1000, Bronze ≥ 1. For this first event, all slots will be Bronze tier.

2. Create /src/types/slot.types.ts — TypeScript interfaces: SlotSeedItem, Slot (Firestore doc shape), SlotStatus enum
3. Create /src/types/event.types.ts — Event interface matching the Firestore data model
4. Create /src/types/purchase.types.ts — Purchase interface
5. Create /src/utils/tier.utils.ts — deriveTier(price: number): "Gold"|"Silver"|"Bronze"
6. Create /seeds/seedSlots.ts — Node script using Firebase Admin SDK:
   - Accepts optional --eventId CLI arg, otherwise generates one
   - Creates the event document with status: "upcoming", opensAt set to 1 hour from now
   - Creates all 112 slot documents in /events/{eventId}/slots/ subcollection
   - Sets featuredSlotIds on event doc to the 8 highest-priced slot IDs
   - Idempotent: skips existing slots
   - Add package.json script: "seed": "ts-node seeds/seedSlots.ts"
```

#### Agent C: Cloud Functions — Complete Implementation
```
Task: Implement all 4 Cloud Functions with full business logic.

Files to implement in /functions/src/:

1. /functions/src/utils/admin.ts
   - Initialize Firebase Admin SDK
   - Export: db (Firestore), auth (Auth)

2. /functions/src/lockSlot.ts
   Export: lockSlot = functions.https.onCall(async (data, context) => {
     - Assert context.auth exists (throw UNAUTHENTICATED if not)
     - Destructure { eventId, slotId } from data
     - Run Firestore transaction on /events/{eventId}/slots/{slotId}:
         * Read the slot document
         * If not found: throw NOT_FOUND
         * If slot.status === "locked": return { success: false, reason: "SLOT_LOCKED" }
         * If slot.status === "sold": return { success: false, reason: "SLOT_SOLD" }
         * If event status !== "live": return { success: false, reason: "EVENT_NOT_LIVE" }
         * Set: status="locked", lockedBy=context.auth.uid, lockedAt=serverTimestamp(),
                lockedUntil=Timestamp 30s from now
     - Return { success: true, lockedUntil: <ISO string> }
   })

3. /functions/src/purchaseSlot.ts
   Export: purchaseSlot = functions.https.onCall(async (data, context) => {
     - Assert context.auth exists
     - Destructure { eventId, slotId } from data
     - Run Firestore transaction:
         * Read slot, assert status="locked", lockedBy=uid, lockedUntil > now
         * If lockedBy !== uid: return { success: false, reason: "NOT_YOUR_LOCK" }
         * If lockedUntil <= now: return { success: false, reason: "LOCK_EXPIRED" }
         * Generate purchaseId = uuid
         * Batch:
             - slot: status="sold", purchasedBy=uid, purchasedAt=serverTimestamp(), clear lock fields
             - /purchases/{purchaseId}: full purchase doc (include eventTitle, brand, tier, denormalized)
             - /events/{eventId}: soldSlots = FieldValue.increment(1)
             - /users/{uid}: purchaseCount = FieldValue.increment(1)
         * Read event.totalSlots; if soldSlots+1 === totalSlots, set event.status="closed"
     - Return { success: true, purchaseId }
   })

4. /functions/src/releaseSlotOnCancel.ts
   Export: releaseSlotOnCancel = functions.https.onCall(async (data, context) => {
     - Assert context.auth exists
     - Transaction on slot:
         * Read slot; if status !== "locked" or lockedBy !== uid, return { success: true } (already released)
         * Set: status="available", lockedBy=null, lockedAt=null, lockedUntil=null
     - Return { success: true }
   })

5. /functions/src/releaseExpiredLocks.ts
   Export: releaseExpiredLocks = functions.pubsub.schedule("every 60 seconds").onRun(async () => {
     - Use collectionGroup("slots") query: where status=="locked" AND lockedUntil < now
     - For each result, batch update: status="available", clear lock fields
     - Log count of released locks
   })

6. /functions/src/index.ts — export all 4 functions

Set minInstances: 1 on lockSlot and purchaseSlot using runWith({ minInstances: 1 }).
Use us-central1 region for all functions.
```

---

### Wave 3 — Real-Time Layer

**Launch all three agents in a single message (parallel). Depends on Wave 2 being complete.**

#### Agent A: Browsing Screens + Components
```
Task: Build all browsing screens and reusable UI components. Auth is done, types are defined, theme/brands constants exist.

Key files available to read for context:
- /src/constants/theme.ts — color palette
- /src/constants/brands.ts — brand enum + colors
- /src/constants/slots.data.ts — slot data shape
- /src/types/slot.types.ts, event.types.ts

Components to build:
1. /src/components/ui/TierBadge.tsx — Gold/Silver/Bronze pill badge with matching colors
2. /src/components/ui/StatusBadge.tsx — LIVE (green), LOCKED (amber #F59E0B), CLAIMED (grey) badges
3. /src/components/ui/CountdownTimer.tsx — HH:MM:SS countdown display, accepts targetDate: Date
4. /src/components/slots/SlotCard.tsx:
   - Shows: wrestlerName (bold), members (smaller dimmed text), price formatted as $X.XX, TierBadge, StatusBadge
   - Available: "BUY SPOT" button (red), full opacity
   - Locked by others: amber LOCKED badge, semi-transparent (0.6 opacity), no button
   - Sold: grey CLAIMED overlay, greyed out, no button
   - Locked by current user: show "YOUR LOCK" badge
   - Accepts onBuySpot callback prop (wired up in parent)
5. /src/components/slots/FeaturedSlotCard.tsx — horizontal scroll card for home screen Top Contenders section
6. /src/components/events/EventCountdown.tsx — "LIVE BREAK IN: HH:MM:SS" or pulsing "🔴 LIVE NOW" based on event.status

Screens to build:
7. /src/screens/events/EventsListScreen.tsx:
   - BREAKBOX WWE header
   - EventCountdown for next/active event
   - "ENTER THE ARENA" button (disabled + dimmed if event.status="upcoming", glowing red if "live")
   - "TOP CONTENDERS (HIGH VALUE)" FlatList horizontal scroll using event.featuredSlotIds
   - Navigation: button → EventDetailScreen
8. /src/screens/events/EventDetailScreen.tsx — event title, status, description, "Enter The Arena" CTA → SlotsRosterScreen
9. /src/screens/events/SlotsRosterScreen.tsx:
   - SectionList with 4 sections: RAW, SMACKDOWN, NXT, LEGENDS
   - Section headers with brand accent color left border + tint background
   - Renders SlotCard per slot
   - "BUY SPOT" tap: calls lockSlot (import from functions.service.ts — stub it for now), navigates to Checkout on success

Navigation:
10. /src/navigation/MainTabs.tsx — bottom tab navigator: "Events" tab + "My Purchases" tab
11. /src/navigation/EventsStack.tsx — stack: EventsList → EventDetail → SlotsRoster → Checkout (placeholder)

For any data fetching in screens, use placeholder/mock data since hooks are being built in parallel (Agent B). Use a simple useState with hardcoded test data. Leave a TODO comment: "// TODO: replace with useSlots(eventId) hook"
```

#### Agent B: Core Hooks
```
Task: Implement all real-time data hooks. Types are defined in /src/types/. Firebase is initialized in /src/config/firebase.ts.

1. /src/services/events.service.ts:
   - subscribeToEvents(callback): onSnapshot on /events collection, ordered by opensAt asc
   - subscribeToEvent(eventId, callback): single event document listener
   Returns unsubscribe function in both cases.

2. /src/services/slots.service.ts:
   - subscribeToSlots(eventId, callback): onSnapshot on /events/{eventId}/slots subcollection
   Returns unsubscribe function.

3. /src/services/functions.service.ts:
   - Import firebase.functions() from /src/config/firebase.ts
   - Export typed callable wrappers: lockSlot, purchaseSlot, releaseSlotOnCancel
   - Each wrapper calls .httpsCallable(name)(data) and returns the typed result

4. /src/hooks/useEvent.ts:
   - Takes eventId: string
   - Calls subscribeToEvent in useEffect, returns { event, loading, error }
   - Cleans up listener on unmount

5. /src/hooks/useSlots.ts:
   - Takes eventId: string
   - Calls subscribeToSlots in useEffect
   - Groups slots by brand client-side into { RAW: Slot[], SMACKDOWN: Slot[], NXT: Slot[], LEGENDS: Slot[] }
   - Also computes sections array for SectionList: [{ title: "RAW", data: [...] }, ...]
   - Returns { slotsByBrand, sections, loading, error }
   - Cleans up listener on unmount

6. /src/hooks/useCountdown.ts:
   - Takes targetDate: Date
   - setInterval every 100ms computing Math.max(0, differenceInMilliseconds(targetDate, new Date()))
   - Returns { msRemaining: number, secondsRemaining: number, isExpired: boolean }
   - Cleans up interval on unmount

7. /src/hooks/useSlotLock.ts — the core lock state machine:
   State type: "idle" | "locking" | "locked" | "expired" | "purchasing" | "purchased" | "error"
   - lockSlot(eventId, slotId): calls functions.service lockSlot, transitions idle→locking→locked on success, idle→error on failure
   - startPurchase(): transitions locked→purchasing
   - completePurchase(eventId, slotId): calls functions.service purchaseSlot, transitions purchasing→purchased on success
   - cancel(eventId, slotId): calls releaseSlotOnCancel, resets to idle
   - On state="locked": internally uses useCountdown with lockedUntil; auto-transitions to "expired" when countdown hits 0
   - Returns: { state, lockData: { lockedUntil, slotId } | null, secondsRemaining, actions: { lock, cancel, purchase } }

8. /src/store/checkoutStore.ts — Zustand: { selectedSlot: Slot|null, lockData: LockData|null, set, clear }
9. /src/store/toastStore.ts — Zustand: { message: string, type: "success"|"error"|"info", visible: boolean, show(msg, type), hide }
10. /src/components/ui/Toast.tsx — positioned at top of screen, reads toastStore, auto-dismisses after 3s
```

#### Agent C: Security Rules + Indexes
```
Task: Finalize and validate Firebase security configuration files.

1. Write /firestore.rules — complete rules:
   - Authenticated users can read /events/{eventId} and /events/{eventId}/slots/{slotId}
   - Authenticated users can read their own /users/{userId} document
   - Authenticated users can write their own /users/{userId} document (for profile updates)
   - Authenticated users can only read /purchases/{purchaseId} where resource.data.userId == request.auth.uid
   - All other writes are denied (slots + purchases only written by Cloud Functions via Admin SDK)

2. Write /firestore.indexes.json — include:
   - Collection group index on "slots": status ASC, lockedUntil ASC (required by releaseExpiredLocks)
   - Collection index on "purchases": userId ASC, purchasedAt DESC (required by usePurchases query)

3. Write /src/config/firebase.ts — complete implementation:
   - Import RNFirebase modules: @react-native-firebase/app, /auth, /firestore, /functions
   - Export typed instances: auth(), firestore(), functions()
   - Configure functions to use us-central1 region

4. Update /app.json to include the @react-native-firebase/app config plugin with correct google-services file paths.

5. Create /.firebaserc with the project alias pointing to "breakbox-wwe".
```

---

### Wave 4 — Transaction Layer

**Launch all three agents in a single message (parallel). Depends on Wave 3 complete.**

#### Agent A: Checkout Screen
```
Task: Build CheckoutScreen and LockCountdown. Hooks (useSlotLock, useCountdown) are complete in /src/hooks/.

1. /src/components/slots/LockCountdown.tsx:
   - Circular countdown arc using react-native-reanimated (useSharedValue + withTiming for arc progress)
   - Accepts secondsRemaining: number (0–30)
   - Large number in center showing seconds
   - Color transitions: green (#22C55E) when > 15s, amber (#F59E0B) when 8–15s, red (#CC0000) when < 8s
   - Arc color matches the number color

2. /src/screens/events/CheckoutScreen.tsx:
   - Receives navigation params: { eventId: string, slotId: string, slotData: Slot }
   - Uses useSlotLock hook — the lock state is already "locked" when arriving here (lock was done in SlotsRosterScreen)
   - Shows: slot wrestler name (large bold), brand badge, tier badge, price ($X.XX)
   - LockCountdown component showing remaining seconds
   - "ONE SPOT PER TRANSACTION" notice
   - Fake PayPal button (styled PayPal blue/yellow): triggers purchaseSlot on tap
     Add comment: // TODO: Replace with PayPal SDK - create order, capture payment
   - Cancel button: calls useSlotLock.cancel(), navigates back
   - Loading overlay during purchase (semi-transparent black + ActivityIndicator)
   - When state="expired": show full-screen overlay "TIME EXPIRED — SLOT RELEASED" with "GO BACK" button
   - When state="purchased": navigate to PurchaseSuccessScreen
   - Intercept navigation-away via beforeRemove event listener: call cancel before navigating
   - Present as modal (full-screen modal style)

3. /src/screens/events/PurchaseSuccessScreen.tsx:
   - "YOU CLAIMED IT!" header in gold
   - Wrestler name, event title, tier badge, price paid
   - Simple confetti effect (use Reanimated — animate 20 colored dots falling from top)
   - "View My Purchases" button → navigate to My Purchases tab
   - "Back to Event" button → pop back to SlotsRosterScreen
```

#### Agent B: My Purchases Screen
```
Task: Build the My Purchases screen and purchase history components. Types are in /src/types/purchase.types.ts.

1. /src/hooks/usePurchases.ts:
   - Queries /purchases collection: where userId == auth.uid, orderBy purchasedAt desc
   - Uses onSnapshot for real-time updates
   - Returns { purchases: Purchase[], loading, error }
   - Cleans up on unmount

2. /src/components/slots/PurchaseHistoryCard.tsx:
   - Glass card style (GlassCard component)
   - Shows: wrestlerName (bold), eventTitle (dimmed), brand badge with accent color, TierBadge, price, formatted date
   - Layout: wrestler name + price on top row, event + brand + tier on second row, date at bottom

3. /src/screens/purchases/MyPurchasesScreen.tsx:
   - Uses usePurchases hook
   - FlatList of PurchaseHistoryCard components
   - Loading skeleton while loading
   - Empty state: centered "No purchases yet" text, "Enter the Arena!" red button → navigate to Events tab
   - Group by event: if multiple purchases exist from same eventId, show event title as a section header
   - Pull-to-refresh (though real-time listener handles updates, add it for UX polish)
```

#### Agent C: Toast System + Error Handling
```
Task: Wire up the global toast system throughout the app and add error handling to all existing screens.

1. /src/components/ui/Toast.tsx:
   - Reads from toastStore (Zustand)
   - Positioned absolutely at top (safe area aware)
   - Animated slide-in from top using Reanimated
   - Auto-dismisses after 3s via useEffect
   - Colors: error=red background, success=green, info=dark glass
   - Add to App.tsx root level (renders above NavigationContainer's children)

2. Wire toast calls throughout existing screens:
   - LoginScreen: show error toast on auth failure (replace any alert() calls)
   - RegisterScreen: same
   - SlotsRosterScreen: show "SLOT_LOCKED — Try another slot!" and "SLOT_SOLD — This slot was just claimed" toasts
   - CheckoutScreen: show "Purchase failed — please try again" on purchaseSlot error

3. /src/components/ui/LoadingOverlay.tsx:
   - Full-screen semi-transparent overlay with ActivityIndicator
   - Accepts visible: boolean prop
   - Use in CheckoutScreen during purchase

4. Add KeyboardAvoidingView to LoginScreen and RegisterScreen (behavior: "padding" on iOS, "height" on Android)

5. Review all useEffect hooks in hooks/ files and ensure every Firestore onSnapshot listener has proper cleanup (return unsubscribe in useEffect return function).
```

---

### Wave 5 — Polish + Deployment

**Launch all three agents in a single message (parallel). Depends on Wave 4 complete.**

#### Agent A: Animations
```
Task: Add all Reanimated animations for polish.

1. SlotCard status transitions (in /src/components/slots/SlotCard.tsx):
   - When slot.status changes to "locked": amber pulse animation (useSharedValue opacity 1→0.7→1, withRepeat x3)
   - When slot.status changes to "sold": grey overlay slides in from right (translateX from 100% to 0)
   - Use react-native-reanimated useAnimatedStyle + withTiming

2. EventsListScreen "ENTER THE ARENA" button when event is live:
   - Glowing red shadow effect: animate shadow opacity/spread with withRepeat + withTiming
   - Button scale pulse: subtle 1.0 → 1.02 → 1.0 repeat

3. EventCountdown live badge:
   - When event.status="live", show "🔴 LIVE NOW" with pulsing red dot (opacity 1→0→1 withRepeat infinite)

4. CheckoutScreen LockCountdown:
   - Smooth arc animation: withTiming on shared value for stroke dash offset
   - Number text: withSpring on scale when seconds change (subtle pop)

5. SlotsRosterScreen:
   - FlatList item enter animation: each SlotCard fades in with translateY from 20 to 0 on list mount
   - Use Reanimated's FadeInDown entering animation

6. PurchaseSuccessScreen confetti:
   - 20 colored particles, each with random x velocity + gravity y acceleration
   - Animate for 2 seconds then stop
```

#### Agent B: Typography + Visual Polish
```
Task: Apply fonts and final visual polish throughout the app.

1. Load fonts in App.tsx using expo-font and @expo-google-fonts/oswald:
   - Oswald_700Bold for all headings (event names, wrestler names, screen titles)
   - Oswald_400Regular for subheadings
   - System font for body text (no custom font needed)
   - Use useFonts hook, show SplashScreen until fonts load

2. Update theme.ts to add typography constants:
   - FONT_HEADING: 'Oswald_700Bold'
   - FONT_SUBHEADING: 'Oswald_400Regular'
   - FONT_BODY: 'System'
   - SIZE_XL: 32, SIZE_LG: 24, SIZE_MD: 18, SIZE_SM: 14, SIZE_XS: 12

3. Apply fonts consistently across all screens — update each screen/component to use theme typography:
   - All event/wrestler names → Oswald_700Bold
   - All prices → Oswald_700Bold with gold color
   - All body/description text → system font

4. Brand section headers in SlotsRosterScreen:
   - Left border (4px) in brand accent color
   - Background tint (brand color at 10% opacity)
   - Brand name in Oswald_700Bold

5. GlassCard refinement:
   - Add subtle 1px border with GLASS_BORDER color
   - BlurView intensity: 20 on iOS, skip blur on Android (use solid GLASS_BG instead — BlurView performance on Android is poor)

6. Navigation header styling:
   - All stack navigators: dark background (#0A0A0A), white text, "BREAKBOX WWE" brand logo as header title
   - Bottom tabs: dark background, red active tint, grey inactive tint

7. Status bar: dark content (light icons) on all screens.
```

#### Agent C: EAS Build + Deployment Prep
```
Task: Configure everything needed for building and deploying to TestFlight and Google Play internal testing.

1. /eas.json — complete build profiles:
   development: { developmentClient: true, distribution: "internal" }
   preview: { distribution: "internal", ios: { simulator: false }, android: { buildType: "apk" } }
   production: { autoIncrement: true, ios: { buildType: "release" }, android: { buildType: "app-bundle" } }

2. /app.config.js (dynamic config — replace app.json):
   - Read Firebase config from process.env (EAS secrets)
   - Export config with all required fields

3. Create /.env.example listing all required environment variables:
   FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
   FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID

4. Create app icon placeholder: /assets/icon.png (1024x1024 solid dark with "BW" text) and /assets/splash.png
   Note: Real icon design is out of scope — just create a valid placeholder

5. Update /functions/src/lockSlot.ts and purchaseSlot.ts:
   - Add runWith({ minInstances: 1, region: "us-central1" }) to both functions

6. Create /README.md with setup instructions:
   - Firebase project creation steps
   - Where to put google-services.json and GoogleService-Info.plist
   - How to run the seed script
   - EAS build commands for preview builds
   - How to set EAS secrets

7. Final dependency audit: ensure all packages in package.json have compatible versions with current Expo SDK.
   Run: npx expo-doctor to check for issues.

8. Verify firestore.indexes.json and firestore.rules are correct by running:
   firebase firestore:indexes and reviewing output.
```

---

### Orchestration Notes for the Executing Agent

- **Always launch a full wave in a single message** with multiple parallel Agent tool calls. Never launch agents one at a time within a wave.
- **After each wave**, read the key output files from that wave before briefing the next wave's agents. This ensures each agent's prompt contains accurate file paths and API shapes.
- **Wave boundaries are hard stops** — a Wave N agent must not start until all Wave N-1 agents report complete.
- **If an agent fails or produces incorrect output**, fix it inline before proceeding to the next wave. Do not cascade broken contracts forward.
- **The seed script (Wave 2 Agent B) requires a real Firebase project** to run against. Flag this to the user before Wave 2 if the Firebase project hasn't been created yet. This is the only step that requires manual user action outside of code writing.
- **After Wave 4**, manually test the slot locking race condition (two simulator instances) before starting Wave 5 polish.
