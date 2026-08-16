# Frontend — Architecture (`frontend/`)

Next.js 16 (App Router), React 19, Tailwind v4. No global state
library/context — each page fetches its own data client-side and passes it
down as props.

## Pages (`app/`)

| Route | File | What it does |
|---|---|---|
| `/` | `app/page.tsx` | Landing page: hero + address search, "how it works," feature cards, and a `FeaturedCarousel` of sample reports (`buildFeaturedReport` from `lib/mock-data.ts` — always mock, not wired to the backend). Server component. |
| `/report?address=` | `app/report/page.tsx` → `components/ReportView.tsx` | The main report screen. Client component wrapped in `<Suspense fallback={<ReportSkeleton />}>` because it reads `useSearchParams()`. |
| `/compare?a=&b=` | `app/compare/page.tsx` → `components/CompareView.tsx` | Two `CompareColumn`s side by side, each independently searchable, syncing `a`/`b` query params via `router.replace`. |

`app/layout.tsx` is the root layout: loads the Geist fonts, renders
`<Header>`, and — the one piece of server-rendered logic here — conditionally
injects the Google Maps JS `<script>` tag into `<head>` if
`GOOGLE_MAPS_API_KEY` (or `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) is set. This is
what makes `window.google` available to `MapPanel` without needing a
client-side env var.

## API routes (`app/api/`)

These are Next.js Route Handlers — same-origin proxies the frontend calls
from the browser, distinct from the separate Express `backend/` API.

| Route | Purpose |
|---|---|
| `api/geocode/route.ts` | Google Geocoding + Places Details proxy. Takes `?address=` or `?placeId=`, returns `{ address, lat, lng, placeId }`. Server-side only — keeps the Google API key off the client. |
| `api/autocomplete/route.ts` | Google Places Autocomplete (New) proxy. Falls back to a small local mock address list (`lib/mock-data.ts#findSuggestions`) if no API key is configured *or* if the live Google call errors — so the search box never shows an empty dropdown just because Places isn't enabled. |
| `api/report/route.ts` | **Legacy / currently unused.** Returns a fully mocked `ReportResponse` for a given address. Predates the real Express backend integration — nothing in the UI calls this route anymore (`ReportView` and `CompareColumn` call `lib/api.ts#fetchReport()` directly, which talks to the Express backend). Kept for reference/rollback, not part of the live data path. |

## Data flow for a single report

```
AddressSearch (user types/selects)
   │ router.push(`/report?address=...`)
   ▼
ReportView (reads ?address from useSearchParams)
   │ 1. getLatLng(address)         — lib/api.ts, calls /api/geocode (Google)
   │ 2. fetchReport(lat, lng, address) — lib/api.ts, calls the Express backend
   ▼
ScorePanelCard × 2, VerdictBanner, MapPanel
```

See [`frontend-lib.md`](./frontend-lib.md) for exactly what `getLatLng` and
`fetchReport` do, including the mock-data fallback behavior that's important
to understand before assuming what's on screen is real.

## Styling

Tailwind v4, configured via `app/globals.css` using CSS custom properties
(`--brand`, `--status-good`, `--series-building`, `--surface-1`, etc.) rather
than Tailwind's default palette — every component references colors as
`var(--token)`, either inline (`style={{ color: "var(--brand)" }}`) or via
the `text-[color:var(--token)]` arbitrary-value utility. This is what makes
the whole app re-themeable from one file.

## A note on this Next.js version

`frontend/AGENTS.md` (surfaced automatically to AI coding agents via
`frontend/CLAUDE.md`) warns that this project pins a Next.js version newer
than most training data and points at `node_modules/next/dist/docs/` as the
authoritative reference before writing App Router / Route Handler code here.
Worth knowing if something about routing or env-var loading looks
unfamiliar compared to older Next.js docs.

## Further reading

- [`frontend-components.md`](./frontend-components.md) — full component catalog
- [`frontend-lib.md`](./frontend-lib.md) — `api.ts`, `mock-data.ts`, `score.ts`, `types.ts`
