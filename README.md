<p align="center">
  <img src="assets/logo.svg" alt="Yorin.vite logo" width="96" height="96" />
</p>

<h1 align="center">Yorin.vite</h1>

<p align="center">
  An online event-invitation platform to create, upload, organize by guest list, and privately share invitations.
</p>

<p align="center">
  <strong>Flow:</strong> Landing page → Google sign-in → Dashboard → Create event → Create or upload invitation → Assign guest list &amp; page view → Preview → Save → Share private link
</p>

---

## Features

* **Google Sign-In & Isolation**: Persistent sessions via Firebase Authentication, protected routes, and strict per-user data isolation.
* **Event Management**: Create and manage events with name, event type, date picker, and location, complete with skeleton loading states and sign-out confirmation.
* **Built-in Invitation Editor**: 6 templates, editable event details, 13 curated Google Fonts, custom colors, background patterns, borders, dividers, alignment/size controls, and live preview.
* **Multi-File Upload**: Upload up to **10 files** per invitation (PDF, JPG, PNG, WebP, GIF, AVIF, BMP) with drag-and-drop, magic-byte file-type detection, size limits, and image/PDF previews. Originals are stored byte-for-byte to preserve quality and proportions.
* **Page View Modes**: Choose how multi-page uploaded invitations are displayed to guests — **Vertical**, **Horizontal**, or **Page (3D flipbook)**.
* **Guest Lists**: Organize invitations into per-event guest lists with typeahead suggestions and quick filtering.
* **Private Sharing (Drive-Style)**: Unguessable 192-bit share links (`#/s/<token>`), copy-to-clipboard, instant on/off revocation, link reset, and a responsive desktop/mobile public viewer. Deleting an invitation automatically removes its share link.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | Vanilla ES Modules, HTML5, CSS3 (no framework, zero `npm install` runtime dependencies) |
| **Auth & Database** | Firebase Authentication & Cloud Firestore (v10 via CDN import map) |
| **File Storage** | Supabase Storage REST API (`js/supabase.js` & `js/services/storage.js`) |
| **PDF Rendering** | `pdf.js` (loaded on demand from cdnjs) |
| **Tooling & Tests** | Node.js ≥ 18 scripts (`config`, `dev`, `build`, `node --test`) |

---

## Quick Start

1. **Set up Firebase & Supabase** — follow [FIREBASE_SETUP.md](FIREBASE_SETUP.md) and [SUPABASE_SETUP.md](SUPABASE_SETUP.md).
2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Fill in your Firebase Web App and Supabase Storage values in `.env`.
3. **Run the dev server**:
   ```bash
   npm run dev
   ```
   Open **http://localhost:5173** in your browser.

> Without a `.env` file, the app displays a setup guide showing which values are missing.

---

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Generates `js/env-config.js` from `.env` and starts the local dev server on port `5173` |
| `npm run config` | Regenerates `js/env-config.js` from `.env` |
| `npm run build` | Outputs a production-ready static site into `dist/` with env config baked in |
| `npm test` | Runs the unit test suite (`tests/*.test.mjs`) |
| `node tests/e2e.mjs` | Runs the end-to-end Playwright browser test suite |
| `npm run deploy:rules` | Deploys `firestore.rules` using the Firebase CLI |
| `npm run deploy` | Builds `dist/` and deploys to Firebase Hosting |

---

## Project Structure

```text
assets/
  logo.svg                  App icon
css/
  styles.css                Design system, UI components & invitation renderer styles
js/
  main.js, router.js        App bootstrap & hash router with auth guards
  firebase.js, supabase.js  Firebase & Supabase client initialization
  services/                 auth.js · db.js (Firestore) · storage.js (Supabase)
  lib/                      Pure utilities: validate, design, filetype, token, format, route-match
  templates/templates.js    Invitation templates, fonts & option lists
  ui/                       Reusable UI: dom, shell, render-invitation, file-viewer,
                            category-picker, date-picker, share-dialog, save-review, invitation-card
  pages/                    landing, dashboard, event-new, event, editor, upload,
                            invitation-edit, shared (public guest viewer)
scripts/                    generate-config.mjs, dev-server.mjs, build.mjs
tests/                      Unit tests, E2E tests & in-memory Firebase fakes
firestore.rules             Firestore security rules
firebase.json               Firebase Hosting & rules configuration
```

---

## Data Model

```text
users/{uid}            displayName, email, photoURL, createdAt, lastLoginAt
events/{id}            ownerId, name, type, customType, date, location, createdAt, updatedAt
categories/{id}        ownerId, eventId, name, nameLower, order, isDefault, createdAt
invitations/{id}       ownerId, eventId, categoryId, name, creationType ('created'|'uploaded'),
                       viewMode ('vertical'|'horizontal'|'flip'),
                       design {…} | files [{path, name, contentType, kind, size, width, height}],
                       thumbnail, sharingEnabled, shareToken, createdAt, updatedAt
shares/{token}         invitationId, ownerId, enabled, kind, name, viewMode,
                       design | files, createdAt, updatedAt
```

`shares/{token}` is a read-only-by-token snapshot synced whenever an invitation is updated, ensuring public guests never access your private `events` or `invitations` documents.

---

## Security Model

* **Firestore Rules ([firestore.rules](firestore.rules))**: Enforces document ownership, immutable `ownerId`/`eventId`, cross-checks between events and guest lists, strict field validation (`hasOnly`), and deny-by-default access.
* **Private Share Tokens**: Generated with 24 random bytes via `crypto.getRandomValues` (192 bits). Links use `#/s/<token>` so the token stays in the URL hash fragment and is never sent in HTTP requests or `Referer` headers.
* **File Validation**: Uploads are verified by magic bytes (not just filename/MIME type); SVG and unsupported formats are rejected.
* **XSS Protection**: All user-supplied text is rendered via safe DOM text nodes, and stored designs are re-sanitized before rendering.

---

## Testing

```bash
npm test                               # Run all unit tests
node tests/e2e.mjs                     # Run end-to-end browser tests (requires Playwright)
SHOTS_DIR=./shots node tests/e2e.mjs   # Save E2E screenshots
```
