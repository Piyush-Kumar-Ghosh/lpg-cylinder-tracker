# Flame — LPG Cylinder Tracker

Flame helps a household keep track of LPG refills from booking through delivery, installation, and empty. It records the figures the household knows, calculates totals and completed usage durations, and makes transparent estimates from the household’s own completed cylinders.

## Features

- Book refills and move them through Booked, Delivered, In Use, Stored / Spare, Empty, and Returned.
- Record expected and actual charges separately; actual amounts take precedence.
- Keep physical cylinder serial numbers separate from internal record IDs.
- Edit and delete records, including notes and special-use context.
- Dashboard for current use, history-based estimates, usage duration, and separate spending totals.
- Monthly reports with booking, delivery, start, or finish date as the explicit reporting basis.
- Yearly and company reports, plus a seasonal view based on completed cylinders.
- Search and filter the cylinder log by company, year, month, lifecycle status, and special usage; sort by date, duration, cost, or company.
- CSV import/export and JSON backup/restore with validation and duplicate protection.
- Household, currency, company, prediction, and in-app reminder settings.
- Responsive layout, keyboard focus indicators, and installable/offline app shell.

The app starts empty. It does not insert sample household records or send data to a service.

## Technology and architecture

- React 19 and TypeScript, bundled by Vite.
- Dexie on IndexedDB for cylinder records and settings.
- Recharts for charts, Vitest for automated domain tests, and Tailwind CSS 4 for CSS processing.
- `src/types` holds the lifecycle and settings model. `src/domain` contains timezone-safe date, money, prediction, and reporting calculations. `src/storage` owns browser persistence and validation. `src/App.tsx` connects the UI to those services.

## Data and calculations

Each cylinder is a single lifecycle record. IndexedDB assigns the sequential internal numeric ID. Calendar dates are stored as `YYYY-MM-DD`; calculations use UTC calendar-day arithmetic to avoid timezone shifts.

Gross total is cylinder charge plus delivery fee. Net total is gross less subsidy. For each amount, an actual figure overrides its booking estimate. Spending excludes cylinders that have not yet been delivered. Cost per day is not calculated.

Completed duration is finish date minus start date. Historical duration uses completed records only by default. The prediction setting selects median, mean, or a chronological weighted average. Estimated empty date is start date plus the chosen duration; suggested booking date is the estimate less the configured delivery buffer. Fewer than three completed cycles are labelled low confidence; the app does not estimate annual usage until there are at least three cycles. A current cylinder is not included in completed averages unless the user opts in.

Monthly and yearly reports group cylinders by the selected booking, delivery, start, or finish date. Finance totals follow the same explicit record basis and still include only delivered refills. Seasonality groups completed cylinders by start month; the view stays empty until there is enough data to show a pattern. Company rows show sample sizes and the app avoids ranking small samples as better providers.

## Storage, privacy, and offline use

Cylinder data and preferences stay in the browser’s IndexedDB. There is no application server, analytics, account, or external calculation API. Browser site data removal also removes the local records, so download backups periodically. CSV and JSON files contain household data; keep them somewhere private.

The service worker caches the application shell for practical offline use. In-app reminders are evaluated while the app is open; reliable background notifications are not implemented. Data does not synchronize between devices.

## Import, export, and restore

CSV export contains the cylinder fields and can be imported back. Import validates rows and dates, rejects negative amounts, and cancels when records are malformed or IDs conflict; it does not silently overwrite existing records. JSON backup includes cylinders and settings. Restore validates records and asks whether to replace existing cylinder records or merge with new IDs. Replacing also restores settings when present.

## Development

The project uses Node.js 20.19 or newer. It is designed to run in a GitHub Codespace; no local project copy is needed when opened there.

```sh
pnpm install
pnpm dev
```

Vite listens on port 5173. In Codespaces, open the forwarded port in the browser. Commands:

```sh
pnpm test       # automated domain and UI workflow tests
pnpm lint       # lint the source
pnpm build      # type-check and create production assets
pnpm preview    # serve a local production build
pnpm verify     # lint, tests, and production build
```

The automated suite covers calculation and report aggregation, CSV field round-trips, IndexedDB close/reopen persistence, and UI workflows for booking through empty, current-cylinder estimates, editing, deletion, multiple in-use cylinders, and spare records.

The included `.devcontainer/devcontainer.json` installs Node.js 20 and forwards port 5173. There are no required secrets or environment variables.

## Deployment

Build with `pnpm build`, then deploy the `dist/` directory to any static host that supports a single-page application fallback to `index.html` and HTTPS. The included GitHub Actions workflow builds with `VITE_BASE_PATH=/lpg-cylinder-tracker/` and deploys `dist/` to GitHub Pages on pushes to `main`. Enable **Settings → Pages → Build and deployment → Source: GitHub Actions** once in the repository. The public site URL is `https://piyush-kumar-ghosh.github.io/lpg-cylinder-tracker/`; the source repository remains private. GitHub Pages availability for private repositories depends on the GitHub account plan. IndexedDB is scoped to the deployed origin; changing domains or clearing browser data will not move records.

## Known limitations

- Background push or operating-system notifications are not supported; reminders appear only in-app.
- No cross-device synchronization or server-side recovery exists.
- The app does not include demo/sample data.

## Repository and Codespaces

The repository is intended to be private because household use information may be sensitive. To create and push a private GitHub repository after authenticating the GitHub CLI:

```sh
gh auth login
gh repo create lpg-cylinder-tracker --private --source=. --remote=origin --push
```

Never commit household exports, browser data, credentials, or secret environment files. `.gitignore` excludes these files and generated dependencies/build output.
