# Flame — Household LPG Log

A private, local-first household ledger for LPG cylinder cycles. Flame records what you know about each refill, calculates duration and spending, and estimates future usage from completed cycles. It does not place orders with LPG providers.

## Features

- Add and edit one complete cylinder record with company, known dates, actual cylinder charge, delivery charge, optional subsidy, special usage, notes, and physical serial number.
- Keep booking and delivery dates optional. Start date and both charges are required; finish date is optional for a current cylinder.
- Reject impossible date sequences, including delivery before booking, installation before delivery, and finish before start.
- See current cylinders, historical duration, a transparent prediction, and suggested booking timing.
- Review monthly, seasonal, company, and yearly analysis. Seasonal analysis compares completed-cycle duration by start month across years; special-use records stay included.
- Import/export CSV and backup/restore JSON. Existing browser records are migrated to the simpler charge fields.
- Attach a photo or PDF receipt to suggest company, dates, charges, and subsidy. Receipt text extraction/OCR runs in the browser; suggested values must be checked.
- Responsive interface, offline app shell, and local IndexedDB persistence.

## Technology and architecture

- React 19, TypeScript, Vite, Recharts
- Dexie over IndexedDB for persistent local data
- Vitest, Testing Library, fake-indexeddb
- PDF.js and Tesseract.js for receipt text extraction and OCR

Domain calculations live in src/domain; storage and version upgrades in src/storage; CSV and receipt processing in src/services; the React interface is in src/App.tsx.

## Calculation rules

- Gross = cylinder charge + delivery charge.
- Net = gross − optional subsidy.
- Duration is calendar days from start to finish. Current cylinders are excluded from completed averages by default.
- Predictions use the configured mean, median (default), or weighted duration of completed cycles. Predicted empty date = start date + estimated duration; suggested booking date = predicted empty date − delivery buffer.
- Confidence depends on the amount and consistency of real history. Estimates are labeled and never guaranteed.
- Monthly reporting groups values by the selected booking, delivery, start, or finish date basis. Records without that date remain unassigned.
- No cost-per-day metric is shown.

## Storage and privacy

Cylinder records and settings stay in the current browser profile's IndexedDB. This static client-side app has no sign-up, login, server database, or household-data upload. Opening the app on another browser/device does not sync records. Clearing browser storage can remove them; export a backup to preserve data.

IndexedDB is **not encrypted by this app**. Device/browser account protections still matter, and exported files should be kept private. Receipt files are processed locally and are not retained by Flame. First-time receipt OCR may download the English recognition model from its distribution host; the receipt itself is not uploaded.

The repository and GitHub Pages site are public because the owner chose free public-repository hosting. Source code is public; household records are not part of the repository and remain in the user's browser.

## Development

Node.js 20.19+ and pnpm are required. In a GitHub Codespace, run:

    pnpm install
    pnpm dev

Commands:

    pnpm test       # automated domain, storage, and workflow tests
    pnpm lint       # lint the source
    pnpm build      # typecheck and production build
    pnpm preview    # serve the production build locally

## Deployment

The GitHub Actions workflow builds and publishes the main branch to GitHub Pages. No backend or secret is required. The site is at https://piyush-kumar-ghosh.github.io/lpg-cylinder-tracker/.

## Limitations

- Receipt reading is best-effort and can misread blurry, handwritten, non-English, or unusual receipts. Verify suggested values.
- This app does not encrypt live browser storage, sync between devices, or provide account recovery. Do not enter household data on a device you do not trust.
- Reminder notices appear only while the app is open; there are no reliable background notifications.
