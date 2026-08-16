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
| **Native Node** | Node ≥ 20.6 (22.x tested) **and** MongoDB |

**Mongo is required** as of M7 — auth stores users and sessions there, and the
app exits at boot without `MONGODB_URI` (Docker provides one for you). A
`JWT_SECRET` is required for the same reason.

The rest still degrades rather than fails: no Socrata token means throttled but
working requests, and no AI provider means template explanations instead of
generated ones. Neither turns an endpoint into an error.

---

## Quick start

### Option A — Docker

Brings up the API plus MongoDB with no local installs.

```bash
cd backend
docker compose up --build
```

```bash
curl localhost:3001/health          # 200, no token needed

# Everything else needs a token. Make an account, then use it:
TOKEN=$(curl -s -X POST localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"a good password","role":"tenant"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).accessToken")

curl -X POST localhost:3001/api/score \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"lat":40.7128,"lng":-74.0060}'
```

The first call for a coordinate takes ~7s (live NYC Open Data). Every call after
that is ~10ms from the Mongo cache.

Full auth reference — endpoints, parameters, Postman examples:
[`API.md`](API.md#authentication).

Two containers run:

| Service | What it is | Host port |
| --- | --- | --- |
| `backend` | the Express API | 3001 |
| `mongo` | MongoDB 8 — `complaint_cache`, `users`, `auth_sessions` | none published |

Docker needs `JWT_SECRET` in `.env` before it will start — see
[Mongo and JWT setup](#mongo-and-jwt-setup).

### Option B — Native Node

You need a MongoDB running and a `JWT_SECRET`. **The app exits at boot without
either** — it will not start half-configured.

```bash
cd backend
npm install
cp .env.example .env

# 1. a Mongo the HOST can reach, then set MONGODB_URI in .env.
#    brew install mongodb-community && brew services start mongodb-community
#    -> MONGODB_URI=mongodb://localhost:27017
#    (Atlas works too. The Compose mongo publishes no host port — see below.)

# 2. a signing secret, into .env as JWT_SECRET=
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"

# 3. start it
npm run dev          # http://localhost:3001, with --watch

# 4. an account to log in with
npm run user:create -- --username demo --password 'a good password' --role tenant
```

If you skipped a step the app tells you which one and exits:

```
[auth] FATAL: JWT_SECRET is unset or shorter than 32 characters.
[auth] FATAL: MONGODB_URI is unset. Mongo is optional for the cache but
        REQUIRED for auth, and auth now guards every data route.
```

`npm start` is the same without file watching. Both load `.env` automatically via
Node's built-in `--env-file-if-exists` — there is no `dotenv` dependency.

---

## Environment setup

**Two variables are now required to boot** (`JWT_SECRET` and `MONGODB_URI`) —
auth guards every data endpoint, and the app exits with instructions if either
is missing. Everything else is still optional.

```bash
cd backend
cp .env.example .env

# generate a signing secret and paste it into .env as JWT_SECRET=
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

| Var | Required? | What it does |
| --- | --- | --- |
| `JWT_SECRET` | **yes** | Signs access tokens. Min 32 chars, no default, never committed. Changing it logs everyone out. |
| `SOCRATA_APP_TOKEN` | strongly recommended | NYC Open Data token. Without one, requests work but throttle hard under load — set it before any demo. |
| `MONGODB_URI` | **yes** | Users and sessions live here. Also enables the complaint cache. |
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

### Mongo and JWT setup

Both are **required** — the app exits at boot without them. Mongo holds the
accounts and sessions auth runs on, not just the complaint cache.

#### Getting a Mongo running

Any Mongo works; the code passes the URI straight through, so local and Atlas
look identical to it. Pick one:

| How | Setup | `MONGODB_URI` |
| --- | --- | --- |
| **All of Docker** (Option A) | `docker compose up` | set for you — nothing to do |
| **Homebrew** (macOS native) | `brew tap mongodb/brew && brew install mongodb-community`<br>`brew services start mongodb-community` | `mongodb://localhost:27017` |
| **Atlas** (free tier, needed for deploy) | create a cluster at [cloud.mongodb.com](https://cloud.mongodb.com), add your IP under Network Access | `mongodb+srv://user:pass@cluster.mongodb.net` |

> **The Compose `mongo` service is not reachable from the host.** It exposes
> 27017 to the other container only — `compose.yaml` publishes no host port on
> purpose. So `docker compose up -d mongo` + `npm run dev` on the host does
> **not** work out of the box. To run the API natively against it, add a
> mapping to the `mongo` service:
>
> ```yaml
> ports:
>   - "127.0.0.1:27017:27017"    # loopback only — do not expose Mongo to the network
> ```
>
> If you already have a local `mongod` on 27017 that will collide; use
> `"127.0.0.1:27018:27017"` and `MONGODB_URI=mongodb://localhost:27018`.

Check Mongo is actually reachable **from where the API runs**, before starting
it. This needs no `mongosh` install — it reuses the driver `npm install` already
put there, and reads `MONGODB_URI` straight from your `.env`:

```bash
node --env-file-if-exists=.env -e "
const {MongoClient}=require('mongodb');
new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:3000}).connect()
  .then(c=>c.db().admin().ping().then(()=>{console.log('mongo ok');return c.close()}))
  .catch(e=>{console.error('mongo NOT reachable:',e.message);process.exit(1)});
"
```

If you do have `mongosh`, `mongosh "$MONGODB_URI" --quiet --eval
'db.adminCommand("ping").ok'` does the same. For the Compose container, run it
inside: `docker compose exec mongo mongosh --quiet --eval
'db.adminCommand("ping").ok'`.

#### Generating `JWT_SECRET`

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Paste it into `.env` as `JWT_SECRET=...`. Minimum 32 characters, no default, one
per environment. Changing it invalidates every issued token — which is also the
emergency "log everyone out" lever.

#### What gets created

Nothing to set up by hand. The app creates its own collections and indexes at
boot:

| Collection | Holds | Self-maintaining |
| --- | --- | --- |
| `complaint_cache` | 311 counts + explanations | 24h TTL, self-refreshing |
| `users` | accounts (scrypt password hashes) | unique index on `username` |
| `auth_sessions` | one doc per active login | TTL removes expired sessions |

Then make an account:

```bash
npm run user:create -- --username demo --password 'a good password' --role tenant
```

Inspect what landed (password hashes projected out):

```bash
node --env-file-if-exists=.env -e "
const {MongoClient}=require('mongodb');
new MongoClient(process.env.MONGODB_URI).connect().then(async c=>{
  console.table(await c.db(process.env.MONGODB_DB).collection('users')
    .find({},{projection:{passwordHash:0}}).toArray());
  await c.close();
});
"
```

### Environment inside Docker

`compose.yaml` reads your `.env`, so `SOCRATA_APP_TOKEN`, `GEMINI_API_KEY`, and
`JWT_SECRET` carry through without being committed.

**`JWT_SECRET` must be set in `.env` or `docker compose up` refuses to start**
with a message telling you so. There is deliberately no dev default — a shared
fallback secret is one copy-paste away from being the production one.

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
npm test                    # 351 tests, no network. Run these on the host, not in Docker.
npm run baseline            # regenerate the citywide baseline (~3 min, live API)
npm run user:create -- --username demo --password 'a good password' --role tenant
npm run user:create -- --username demo --password 'new password' --force   # reset
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
