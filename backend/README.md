# Should I Live Here — backend

NYC 311 address risk API. Send a coordinate, get two 0–100 sub-scores —
**Building Health** (25m radius) and **Block Quality** (350m radius) — each with
complaint counts and a plain-English explanation.

- **HTTP contract:** [`API.md`](API.md) — endpoints, payloads, errors
- **Spec:** [`CLAUDE.md`](CLAUDE.md) — what was decided and why
- **Build log:** [`documentation/`](documentation/README.md)

---

## Prerequisites

Pick one path. You do not need both.

| Path | You need |
| --- | --- |
| **Docker** (recommended for a fresh clone) | Docker Desktop |
| **Native Node** | Node ≥ 20.6 (22.x tested), optionally MongoDB |

Everything else — Mongo, the AI explanations, even the Socrata token — is
**optional**. The app is built to degrade rather than fail: no Mongo means no
cache (slower), no AI provider means template explanations. Every endpoint still
returns 200.

---

## Quick start

### Option A — Docker

Brings up the API plus MongoDB with no local installs.

```bash
cd backend
docker compose up --build
```

```bash
curl localhost:3001/health          # 200

curl -X POST localhost:3001/api/score \
  -H 'Content-Type: application/json' \
  -d '{"lat":40.7128,"lng":-74.0060}'
```

The first call for a coordinate takes ~7s (live NYC Open Data). Every call after
that is ~10ms from the Mongo cache.

Two containers run:

| Service | What it is | Host port |
| --- | --- | --- |
| `backend` | the Express API | 3001 |
| `mongo` | MongoDB 8 for `complaint_cache` | none published |

### Option B — Native Node

```bash
cd backend
npm install
npm run dev          # http://localhost:3001, with --watch
```

`npm start` is the same without file watching. Both load `.env` automatically via
Node's built-in `--env-file-if-exists` — there is no `dotenv` dependency.

---

## Environment setup

**A fresh clone runs with no `.env` at all.** Set one up when you want live data
that isn't throttled, a working cache, or real AI explanations.

```bash
cd backend
cp .env.example .env
```

Then fill in what you need. Nothing here is required to boot.

| Var | Required? | What it does |
| --- | --- | --- |
| `SOCRATA_APP_TOKEN` | strongly recommended | NYC Open Data token. Without one, requests work but throttle hard under load — set it before any demo. |
| `MONGODB_URI` | no | Enables the complaint cache. Absent = slower, not broken. |
| `MONGODB_DB` | no | Defaults to `should_i_live_here`. |
| `PORT` | no | Defaults to `3001`. |
| `USE_MOCK_DATA` | no | `1` serves deterministic mock data — useful for offline frontend work. |
| `AI_PROVIDER` | no | `ollama` (default) or `gemini`. |
| `OLLAMA_MODEL` | no | Defaults to `llama3.1:8b`. |
| `OLLAMA_ENDPOINT` | no | Defaults to `http://localhost:11434/api/generate`. |
| `GEMINI_API_KEY` | for `gemini` | **Never commit this.** |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.5-flash-lite`. |
| `GEMINI_THINKING_BUDGET` | no | Set `0` for `gemini-2.5-*` models; leave unset for 3.x. |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | no | Defaults to 5000. Raise it if your cluster is slow to select. |

### Where to get the credentials

- **Socrata app token** — sign in at
  [data.cityofnewyork.us](https://data.cityofnewyork.us) →
  Profile → Developer Settings → create an app token. Free, instant.
- **Gemini API key** — [aistudio.google.com](https://aistudio.google.com) →
  Get API key. Free tier is enough for a hackathon.

`.env` is gitignored. Keep it that way.

### Mongo

Any Mongo works — the code just passes the URI through, so local and Atlas are
identical to it.

```bash
# local
MONGODB_URI=mongodb://localhost:27017

# Atlas
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net
```

The cache self-refreshes on a 24h TTL and creates its own indexes at boot.

### Environment inside Docker

`compose.yaml` reads your `.env` if it exists (and starts fine if it doesn't), so
`SOCRATA_APP_TOKEN` and `GEMINI_API_KEY` carry through without being committed.

**Three values are deliberately overridden**, because `localhost` inside a
container means *the container*, not your machine:

| Var | Value in Docker |
| --- | --- |
| `MONGODB_URI` | `mongodb://mongo:27017` |
| `OLLAMA_ENDPOINT` | `http://host.docker.internal:11434/api/generate` |
| `PORT` | `3001` |

If you ever think "the container is ignoring my `.env`", this is why — explicit
`environment:` beats `env_file:` in Compose, by design.

---

## Ollama setup (optional — AI explanations)

Each sub-score carries a 1–2 sentence explanation. Without an AI provider that
text comes from a deterministic template; with one it's generated. **This is a
polish feature, not a dependency** — `services/explain.js` catches every failure
(timeout, refused connection, rate limit) and falls back to the template, so
nothing breaks when Ollama isn't there.

### Install and run

```bash
# macOS
brew install ollama          # or download from https://ollama.com/download

ollama serve                 # leave running in its own terminal
ollama pull llama3.1:8b      # ~4.9 GB, once
```

Verify it's up:

```bash
curl -s localhost:11434/api/tags
```

Then start the backend normally — `AI_PROVIDER` defaults to `ollama`, so nothing
else is needed. To confirm you're getting real generations rather than fallback
text, check `explanationSource`:

```bash
curl "localhost:3001/api/explanation?lat=40.7128&lng=-74.0060&tier=block"
# {"explanation":"...","explanationSource":"ai"}   <- ai, not template
```

Want a different model? `OLLAMA_MODEL=llama3` (or anything you've pulled). It's
one variable.

### Ollama with Docker

**Ollama runs on your host, not in a container.** `compose.yaml` points the
backend at `host.docker.internal:11434`, so a host Ollama is picked up
automatically — start `ollama serve`, then `docker compose up`.

There is intentionally no Ollama service in `compose.yaml`. The image plus the
model is a ~5 GB pull, and Docker Desktop on Apple Silicon has no GPU
passthrough, so a containerized 8B model runs CPU-only and would routinely blow
the 45s timeout in `src/config/constants.js` — producing the same template text,
just after a long wait.

### Gemini instead

Faster, and the path a deployment would use. In `.env`:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
```

Compare both providers on identical inputs before trusting either:

```bash
npm run verify:explanations
```

### If explanations come back as `"template"`

| Cause | Fix |
| --- | --- |
| `ollama serve` not running | start it; `curl localhost:11434/api/tags` should answer |
| model not pulled | `ollama pull llama3.1:8b` |
| running in Docker | that's expected unless a **host** Ollama is running |
| generation exceeded 45s | normal on a loaded CPU — use Gemini for consistency |
| a cached explanation is stale | cached text lives until the 24h TTL rolls |

---

## Common tasks

```bash
npm test                    # 299 tests, no network. Run these on the host, not in Docker.
npm run baseline            # regenerate the citywide baseline (~3 min, live API)
npm run verify:dataset      # confirm the 311 dataset hasn't moved
npm run verify:scoring      # score distribution sanity check
npm run verify:cache        # cache round-trip against a real Mongo
npm run verify:explanations # both AI adapters, same inputs, side by side
```

With Docker:

```bash
docker compose logs -f backend
docker compose exec backend npm run baseline
docker compose down                # stop; cached complaints survive
docker compose down -v             # stop and wipe the cache volume
```

Inspect the cache:

```bash
docker compose exec mongo mongosh --quiet \
  --eval 'db.getSiblingDB("should-i-live-here").complaint_cache.countDocuments()'
```

To attach MongoDB Compass, add `ports: ["27017:27017"]` to the `mongo` service.

---

## Notes

- **Tests don't run in the image.** `mongodb-memory-server` would download a
  Linux `mongod` on every run and needs glibc. Keep `npm test` on the host.
- **The backend never geocodes.** It takes `{lat, lng}`; turning an address into
  coordinates is frontend-side work.
- **CORS is `*`.** Fine for a hackathon, tighten before anything public.
- Docker is a dev-environment convenience and does not conflict with the Vercel
  serverless path in `CLAUDE.md` — Vercel ignores Dockerfiles.
