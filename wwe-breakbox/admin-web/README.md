# WWE Breakbox Admin

Internal-only web admin for managing breaking events, viewing purchases, and
toggling user flags. Shares the production Firebase project with the mobile
app — gated by the `admin: true` custom claim on the signed-in user.

## First-time setup

1. **Install deps**
   ```sh
   cd admin-web
   npm install
   ```

2. **Create the hosting site** (one-time, in the Firebase console)
   - Hosting → Add another site → site ID `breakbox-wwe-admin`
   - Default URL becomes `https://breakbox-wwe-admin.web.app`

3. **Grant yourself admin** (one-time)
   ```sh
   cd ../functions
   # Place a service account JSON at functions/serviceAccount.json
   npm install
   npm run build
   node lib/admin/grantAdmin.js grant <your-email-or-uid>
   ```
   Sign out + back in to refresh your ID token.

## Local dev

```sh
cd admin-web
npm run dev
```
The dev server runs at http://localhost:5173 against the production Firebase
project. Sign in with a user that has the admin claim.

## Deploy

```sh
# from repo root
npm --prefix admin-web run build
firebase deploy --only hosting:admin
```

## Notes on isolation

- This package is intentionally **not** part of the Expo workspace.
- Adding deps here (`xlsx`, `react-router-dom`, etc.) does not affect the
  mobile binary — Metro only walks imports from `wwe-breakbox/index.ts`.
- All admin writes go through Cloud Functions (`createEventWithSlots`,
  `setSlotClosed`, `setSlotBrand`, `setUserLegacy`) which enforce the admin
  claim server-side. Firestore rules also check `isAdmin()` for safety.
