# BreakBox WWE

A mobile app for WWE trading card breaking events. Built with React Native + Expo + Firebase.

## Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [EAS CLI](https://docs.expo.dev/eas-update/getting-started/): `npm install -g eas-cli`
- Firebase project named `breakbox-wwe`

## Setup

### 1. Firebase configuration

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** (Email/Password provider)
3. Enable **Firestore** (start in production mode)
4. Enable **Cloud Functions** (requires Blaze plan)
5. Download config files:
   - `google-services.json` → project root (`wwe-breakbox/`)
   - `GoogleService-Info.plist` → project root (`wwe-breakbox/`)

> These files are gitignored. Never commit them.

### 2. Install dependencies

```bash
npm install
```

### 3. Deploy Firebase resources

```bash
# Deploy Firestore rules + indexes
firebase deploy --only firestore

# Build and deploy Cloud Functions
cd functions && npm install && npm run build
cd ..
firebase deploy --only functions
```

### 4. Seed the database

```bash
# Place your service account JSON at seeds/serviceAccount.json
# (Download from Firebase Console → Project Settings → Service Accounts)
cd seeds && npm install
npx ts-node seedSlots.ts
```

This creates an event with 112 slots (status: upcoming). To make it live, change the event's `status` field to `"live"` in the Firestore console.

### 5. Run the app (development)

```bash
# Build the custom dev client (first time only)
eas build --profile development --platform ios   # or android

# Start the dev server
npx expo start --dev-client
```

## EAS Build (distribution)

```bash
# Internal testing (TestFlight / Play Store internal)
eas build --profile preview --platform all

# Production build
eas build --profile production --platform all
```

Set Firebase config as EAS secrets (not needed for RNFirebase — it reads from the plist/json files directly, which are embedded at build time).

## Project Structure

```
wwe-breakbox/
├── src/
│   ├── components/      # Reusable UI components
│   ├── constants/       # Theme, brands, slot data
│   ├── hooks/           # React hooks (useSlots, useSlotLock, etc.)
│   ├── navigation/      # React Navigation stacks/tabs
│   ├── screens/         # Screen components
│   ├── services/        # Firebase service wrappers
│   ├── store/           # Zustand global state
│   ├── types/           # TypeScript interfaces
│   └── utils/           # Utility functions
├── functions/           # Firebase Cloud Functions
└── seeds/               # Database seeding scripts
```

## Architecture

- **Frontend**: React Native + Expo (managed workflow with custom dev client)
- **Auth**: Firebase Authentication (email/password)
- **Database**: Firestore (real-time listeners for slot status)
- **Backend**: Firebase Cloud Functions (atomic slot locking via Firestore transactions)
- **State**: Zustand for global state, TanStack Query for server state
- **Animations**: React Native Animated + Reanimated v3

## Slot Locking Flow

1. User taps "BUY SPOT" → calls `lockSlot` Cloud Function
2. Cloud Function runs a Firestore transaction (serialized) → sets slot to `locked` for 30 seconds
3. User has 30 seconds to complete checkout
4. On purchase → `purchaseSlot` Cloud Function marks slot as `sold`
5. On cancel/timeout → `releaseSlotOnCancel` or scheduled `releaseExpiredLocks` resets slot to `available`

## Payment

Currently uses a fake PayPal button for the purchase flow. To integrate real PayPal:
1. Install PayPal React Native SDK
2. Replace the fake button in `CheckoutScreen.tsx` with PayPal order creation → approval → capture flow
3. Pass the PayPal capture ID to `purchaseSlot` Cloud Function for verification
