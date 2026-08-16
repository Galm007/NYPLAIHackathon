# Frontend — Components (`frontend/components/`)

Grouped by what they're for, not alphabetically. All are `"use client"` where
they hold state/effects; a few (e.g. `StatusBadge`, `ScoreMeter`) are plain
presentational components with no directive needed since they're always
rendered inside an already-client tree.

## Layout

- **`Header.tsx`** — sticky top nav: logo/home link, "Compare" link, and a
  static "Preview · sample data" badge.

## Search

- **`AddressSearch.tsx`** — the address input + autocomplete dropdown used on
  the landing page, report page, and both compare columns. Debounces
  (`150ms`) calls to `lib/api.ts#fetchSuggestions()`, tracks up to 5 recent
  searches in `localStorage`, and supports full keyboard navigation
  (arrow keys, Enter, Escape). Selecting a suggestion or pressing Enter calls
  either a supplied `onSelect` callback or navigates to `/report?address=...`.

## Report page (`components/ReportView.tsx` and its children)

- **`ReportView.tsx`** — the orchestrator. Reads `?address` from the URL,
  geocodes it, fetches the report, and renders the loading skeleton / error
  state / full report accordingly. See
  [`frontend-architecture.md`](./frontend-architecture.md#data-flow-for-a-single-report).
- **`VerdictBanner.tsx`** — the big Good/Fair/Poor headline + badge at the
  top of a report. Computes the overall band as the *worse* of Building
  Health and Block Quality (`lib/score.ts#overallBand`), and renders a
  one-line explanation of *why* via `lib/score.ts#explainVerdict()` — pulls
  the top 1–2 complaint categories that actually drove that band, plus how
  many are still unresolved.
- **`ScorePanelCard.tsx`** — one full score panel (used twice per report:
  Building Health and Block Quality). Composes `ScoreMeter`, `StatusBadge`,
  `ComplaintBreakdownBars`, `TrendSparkline`, and `RecentComplaintsList`.
  - **Important:** the trend chart and Recent Complaints section are both
    gated on `panel.recentComplaints !== undefined`. The real backend's
    `/api/score` response never includes that field — see
    [`frontend-lib.md`](./frontend-lib.md#whats-real-vs-mocked) for what that
    means in practice.
- **`ScoreMeter.tsx`** — the circular 0–100 score gauge (SVG ring, animated
  `stroke-dashoffset`).
- **`StatusBadge.tsx`** — small pill showing a `ScoreBand` with its icon and
  themed color.
- **`ComplaintBreakdownBars.tsx`** — the "By category" list (name + count per
  bucket, no bar visualization — removed by design so only the numbers show).
  For the Block Quality panel specifically, also renders a hover tooltip
  ("Why this score?") explaining which category is driving the score at the
  current score level.
- **`TrendSparkline.tsx`** — the "12-month trend" **bar chart**. Renders
  gridlines with rounded reference numbers, a "Complaints per month" caption,
  and a hover tooltip with the exact month + count. Takes `TrendPoint[]`
  (`{month, count}`) — see `lib/score.ts#buildMonthlyTrend()` for how that's
  derived from `recentComplaints` (bucketed by month, last 12 months only).
- **`RecentComplaintsList.tsx`** — the clickable list of individual
  complaints. Clicking one opens `ComplaintDetailModal`.
- **`MapPanel.tsx`** — the real Google Maps embed (not a static image).
  Loads `maps` + `marker` libraries via `window.google.maps.importLibrary`,
  places a red `AdvancedMarkerElement` at the address, and draws two
  `google.maps.Circle` overlays for the building/block radii. Includes a
  fix for a known Street View bug: dragging the Pegman onto the map can
  render a **blank black canvas** for certain panoramas (especially
  third-party 360 photos); the component listens for the panorama's
  `visible_changed`/`pano_changed` events and force-triggers a `resize` event
  (twice, since the container can still be mid-layout on the first pass) to
  kick the WebGL viewport into actually painting.
- **`ReportSkeleton.tsx`** — the loading placeholder (pulsing gray blocks)
  shown while the report is being fetched.

## Complaint detail modal

- **`ComplaintDetailModal.tsx`** — opens when a complaint in
  `RecentComplaintsList` is clicked. Shows the complaint's current status and
  a visual timeline (connected dots, one per status change) with dates and
  notes, plus the comment thread below it. Closes on Escape or backdrop
  click.
  - **The timeline data is a labeled stub**, not real — 311 doesn't expose
    per-complaint status-change history at all. `lib/mock-data.ts#buildComplaintTimeline()`
    deterministically synthesizes a plausible Open → In Progress → Closed
    sequence from the complaint's submission date and current status. See
    [`frontend-lib.md`](./frontend-lib.md).
- **`ComplaintComments.tsx`** — the comment/reply thread for one complaint.
  - One level of threading (top-level comments, each with a flat `replies[]`
    array — not arbitrarily deep).
  - Admin comments/replies render with a blue-tinted background, border, and
    a "Building Admin" badge, visually distinct from resident comments.
  - **Auth stub:** a checkbox, "Posting as registered building admin," is the
    entire permission model right now (`isBuildingAdmin` local state) — there
    is no real authentication. It exists to demonstrate the intended
    UI/permission structure (only an "admin" can post as one) ahead of real
    auth being wired up.
  - Seeded from `lib/mock-data.ts#buildSeedComments()` (deterministic per
    complaint: one resident comment, plus an admin reply once the complaint
    is past "open"); new comments/replies added during a session live only in
    component state — nothing persists, and there is no backend endpoint for
    comments at all.

## Compare page

- **`CompareView.tsx`** — renders two `CompareColumn`s and keeps their
  addresses in sync with the `?a=` / `?b=` query params.
- **`CompareColumn.tsx`** — a self-contained mini `ReportView`: its own
  `AddressSearch`, its own geocode → fetch flow, and renders
  `VerdictBanner` + two `ScorePanelCard`s + `MapPanel` once loaded.

## Landing page

- **`FeaturedCard.tsx`** — one address card in the homepage carousel: verdict
  color strip, band label, top complaint category per panel, complaint
  totals, links to the full report.
- **`FeaturedCarousel.tsx`** — auto-scrolling horizontal carousel of
  `FeaturedCard`s. Hand-rolled with `requestAnimationFrame` (not a CSS
  animation) so it can pause on hover/touch/wheel and resume smoothly,
  including subpixel scroll accumulation (tracked separately from
  `scrollLeft`, which browsers round to integers on read) and a seamless
  loop by duplicating the report list and snapping back at the midpoint.

## Icons

- **`icons.tsx`** — every icon in the app as a small inline SVG React
  component (`CheckCircleIcon`, `SpinnerIcon`, `AlertTriangleIcon`,
  `XCircleIcon`, `SearchIcon`, `MapPinIcon`, `BuildingIcon`, `BlockIcon`,
  `ChevronRightIcon`, `CloseIcon`, `ClockIcon`). No icon library dependency.
