# M0 — Scaffolding

**Status:** complete
**Covers:** project setup, dependencies, repo shape, `src/config/constants.js`

## Goal

Stand up an empty-but-bootable Express project matching the repo shape in
CLAUDE.md, and encode every magic value from the spec as a named constant in one
file, so no later milestone re-derives complaint-type strings or radii from memory.

## What was built

```
backend/
├── package.json            ESM ("type": "module"), node >= 20.6
├── .gitignore              node_modules, .env, *.log, .DS_Store
├── .env.example            SOCRATA_APP_TOKEN, MONGODB_URI, MONGODB_DB, PORT
├── src/
│   ├── index.js            listener only — reads PORT, calls createApp()
│   ├── app.js              createApp(): builds the app without listening
│   ├── config/constants.js
│   ├── routes/  services/  providers/  lib/
├── scripts/
└── test/
```

### Dependencies

| Package | Why |
| --- | --- |
| `express@^5` | HTTP layer |
| `mongodb@^6` | Official driver — cache + baseline collections (M3/M4) |
| `vitest@^3` (dev) | Test runner for the pure scoring function |

**No `dotenv`.** Node 20.6+ has `--env-file` built in, so `npm run dev` /
`npm start` / `npm run baseline` all use `--env-file-if-exists=.env`. One fewer
dependency, and the `-if-exists` variant means the app still boots before anyone
has created a `.env` — which matters because the team is sharing this repo
before credentials are distributed.

## Decisions

1. **`createApp()` is separate from `index.js`.** The entry point only listens.
   Tests can build the same app in-process without binding a port, so there is
   exactly one wiring path and no "works in tests, broken in prod" gap.
2. **Radii fixed at 25m (building) and 350m (block)**, the midpoints of the
   spec's 20–30m / 300–400m ranges. Person 3 owns radius tuning (CLAUDE.md open
   item 5); these are single constants in `RADIUS_TIERS` so retuning is a
   one-line change.
3. **Band thresholds set at good ≥ 70, fair ≥ 40**, on a 0–100 scale where
   **100 means the fewest complaints**. The scale direction is the part worth
   remembering: a *high* score is *good* news for a renter.
4. **`TYPE_TO_BUCKET` is derived, not hand-written.** It flattens the two bucket
   tables into `complaint_type string -> bucket name`. This is the mechanism that
   enforces CLAUDE.md's critical weighting rule — counts get summed into a bucket
   by lookup, so there is no code path where per-string values could be averaged
   instead.
5. **`BUCKET_WEIGHTS` added but unused (all 1s).** CLAUDE.md decision 6 warns
   that giving a bucket more weight must be explicit, not achieved by padding its
   type list. Having the knob present makes the correct move the easy one.
6. **`windowCutoffISO()` is a function, not a constant.** A 24-month window is
   relative to *now*; a constant computed at import time would silently drift in
   a long-running process.

## Deviation from CLAUDE.md

CLAUDE.md's repo shape lists `/src/{routes,services,providers,config}`. M1 added
**`src/lib/`** for the shared coordinate validator, which is not a route, a
service, or a provider. Flagged here rather than silently expanded.

## Verification

```
$ npm start
.env not found. Continuing without it.
[server] listening on http://localhost:3001
$ curl -o /dev/null -w "%{http_code}" localhost:3001/nope   # -> 404
```

Boots with no `.env`, no Mongo, and no network.
