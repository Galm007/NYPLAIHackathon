# Project documentation

Module-by-module reference for the whole codebase, written by reading the
actual source (not just the planning docs) — each doc says what a module
does, how it's called, and the non-obvious decisions baked into it.

For setup instructions, start with the [root README](../README.md) instead —
these are reference docs, not a getting-started guide.

## Backend (`backend/`)

1. [`backend-architecture.md`](./backend-architecture.md) — layering, request
   lifecycle, app wiring, entry point, core design principles
2. [`backend-routes.md`](./backend-routes.md) — every HTTP endpoint, request/response shapes, error codes
3. [`backend-services.md`](./backend-services.md) — orchestration + the percentile scoring algorithm
4. [`backend-providers.md`](./backend-providers.md) — the Socrata client, Mongo cache, and baseline loader
5. [`backend-config-and-scripts.md`](./backend-config-and-scripts.md) — every tunable constant, plus the offline CLI scripts

See also [`backend/API.md`](../backend/API.md) (endpoint reference with real
captured samples) and [`backend/CLAUDE.md`](../backend/CLAUDE.md) (the data
modeling decisions log — why each complaint type is in or out, known data
caveats like `streetCondition`'s null-geocode rate).

## Frontend (`frontend/`)

1. [`frontend-architecture.md`](./frontend-architecture.md) — pages, API routes, data flow, styling approach
2. [`frontend-components.md`](./frontend-components.md) — every component, grouped by what it's for
3. [`frontend-lib.md`](./frontend-lib.md) — the API client, scoring/formatting helpers, and the mock data generator

## The one thing worth reading before anything else

[`frontend-lib.md`'s note on `fetchReport()`](./frontend-lib.md#apits--client-for-backend--google)
and the root README's
["What's real vs. mocked/stubbed"](../README.md#whats-real-vs-mockedstubbed-right-now)
table explain why a fully-populated-looking report in the UI is not proof the
real backend is being used. Read that before debugging "my teammate can't see
X" — it's usually this, not a bug.
