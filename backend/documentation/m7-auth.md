# M7 — JWT authentication

**Status:** done. **351 tests passing** (299 before M7; +43 in `auth.test.js`,
+9 in `password.test.js`), verified live against a real mongod over real HTTP.

Adds username/password authentication with 7-day JWT access tokens, rotating
refresh tokens, tenant/landlord roles, and real logout. **The data endpoints are
now protected** — this is a breaking change for the frontend, detailed in
[What Person 2 has to change](#what-person-2-has-to-change).

This milestone is **not in CLAUDE.md's build order**. It was requested directly,
and CLAUDE.md's "Auth: none" line and frozen contract are now stale — both are
updated in this commit.

---

## What was built

```
/src
  /lib
    password.js      scrypt hash + constant-time verify (node:crypto, no dep)
    tokens.js        JWT sign/verify, refresh-token generation + hashing
    errors.js        HttpError / Unauthorized / Conflict / ServiceUnavailable
  /providers
    users.js         `users` collection, unique username index
    sessions.js      `auth_sessions` collection, TTL + refresh-hash index
  /middleware
    requireAuth.js   Bearer parsing -> req.auth
  /services
    authService.js   register / login / refresh / logout orchestration
  /routes
    auth.js          the five endpoints
/scripts
  createUser.js      operator path for the first account, and password resets
```

Two new collections, both self-maintaining:

| Collection | Document | Indexes |
| --- | --- | --- |
| `users` | `{_id: uuid, username, passwordHash, role, createdAt, updatedAt}` | `username` unique |
| `auth_sessions` | `{_id: sid, userId, username, refreshTokenHash, createdAt, lastUsedAt, expiresAt}` | `expiresAt` TTL(0), `refreshTokenHash` unique, `userId` |

---

## Endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/register` | none | Create an account, returns a live session |
| `POST /api/auth/login` | none | Exchange credentials for a token pair |
| `POST /api/auth/refresh` | refresh token in body | New access token, rotates the refresh token |
| `POST /api/auth/logout` | access token | Ends the session — both tokens die immediately |
| `GET /api/auth/me` | access token | "Is my stored token still good?" |

Full request/response shapes are in [`../API.md`](../API.md).

---

## Decisions taken

### The 7-day access token is checked against a live session

This is the central design decision and everything else follows from it.

A 7-day bearer token is a long time to be unable to revoke anything. The
stateless-JWT answer to "log me out" is "your token keeps working until it
expires" — acceptable at a 15-minute TTL, not at seven days. So every access
token carries the `sid` of the session that issued it, and `requireAuth` checks
that session document still exists.

The cost is **one indexed `findOne` per authenticated request**. The benefit is
that logout, a stolen token, and a deleted account all stop working *now*
instead of within a week. At this token lifetime that trade is not close.

The alternative considered was a short access token (15 min) plus a 7-day
refresh token, which gets revocation nearly free. It was rejected because the
requirement was explicitly a 7-day token, and this design honours that without
giving up revocation.

### Access tokens are JWTs; refresh tokens deliberately are not

The refresh token is 256 bits of `randomBytes`, and the **only copy we store is
a SHA-256 hash**. Nothing in it is meant to be read by a client, so signing it
would add parsing surface and no value. Hashing it means a database dump does
not hand out working sessions.

Plain unsalted SHA-256 rather than scrypt, unlike passwords: the input is
uniform randomness we generated ourselves, so there is no dictionary for a slow
KDF to defend against — and lookup has to be deterministic.

### Refresh tokens rotate, and rotation is atomic

Every refresh issues a new refresh token and invalidates the submitted one, so a
captured token is worthless once the real client has refreshed once.

Rotation is a single `findOneAndUpdate` matching on the **old** hash. That is
what makes a concurrent double-refresh safe: two requests race for one document,
exactly one matches, the loser gets a 401. A read-then-write would let both
succeed and leave two live refresh tokens. There is a test for precisely this.

### Passwords use `node:crypto` scrypt, not bcrypt

No dependency and no native build step, which matters because the image is
alpine/musl (see [docker.md](docker.md)) — `bcrypt` would need a compiler in the
Dockerfile. The stored format is self-describing (`scrypt$N$r$p$salt$key`) so the
parameters can be raised later without invalidating existing hashes.

`maxmem` has to be raised explicitly: scrypt at N=16384, r=8 needs ~16MB and
Node's default cap is 32MB with no headroom, so the call fails outright rather
than running slowly.

### Roles are required at registration, with no default

`role` is `"tenant"` or `"landlord"`, chosen at registration and required.
"tenant" would be the obvious default, but silently assigning it to a landlord
who omitted the field is worse than a 400 telling them to pick — the account
would be wrong and nobody would find out until a role check started mattering.

The role rides **in the access token**, so a future role check costs no extra
lookup. The trade is that a role changed in the database is not reflected until
the token is refreshed — up to 7 days. That is fine while nothing branches on it
and is called out in `tokens.js`; it needs revisiting before anything does,
because a demoted landlord would keep landlord access for a week.

Nothing branches on role yet. It is identity, stored and surfaced, ready for
whoever adds landlord-specific behaviour.

`createUser.js --force` does **not** change the role. "Reset my password" is not
"change my account type", and conflating them in a script that already ends
every session would be a surprising way to lose a role.

### Login does not tell you which half was wrong

An unknown username and a wrong password return an identical
`401 invalid_credentials`. Different responses would be a free
username-enumeration tool.

That is only half the fix — timing gives it away too, since a missing user
would skip scrypt entirely and return in ~0ms against ~80ms for a real one. So
`loginUser` verifies against a **dummy hash** when the user does not exist, and
both paths cost the same. There is a test asserting the two responses are byte
identical; the timing half is enforced by the code and commented there.

### Login validation is looser than registration validation

Registration enforces the username pattern and length. Login checks only that
both fields are present strings.

Applying the registration rules at login would turn a `400 invalid_username`
into a second enumeration oracle — it tells an attacker which guesses could even
be a real account — and would lock out any existing user if the rules are ever
tightened.

### Every auth field is type-checked before it reaches Mongo

`requireString` rejects non-strings in one place for every auth field. Express
parses JSON, so `{"password": {"$ne": null}}` arrives as an object, and reaching
a Mongo query as an operator is the classic NoSQL injection. Tested.

### `algorithms` is pinned on verify

`jwt.verify(token, secret, { algorithms: ["HS256"] })`. Without it, a token
whose header says `alg: none` is accepted. This is the single most common JWT
vulnerability and it is a one-line omission. Tested with a real `alg: none`
token.

### The app refuses to boot without `JWT_SECRET` or `MONGODB_URI`

Both are now hard requirements and `src/index.js` exits 1 with instructions if
either is missing.

There is deliberately **no fallback secret**. A default would mean anyone with
the source could mint valid tokens for any deployment running it, and the "we'll
change it before deploy" step is the one that gets skipped.

`MONGODB_URI` becoming mandatory is a real change of character for this
codebase — see the roadblock below.

### `/health` stays public

A deploy health check and a keep-warm ping carry no credentials, and a 401 there
reads to the host as a failed deploy. It exposes only "the process is up".

### Logout is idempotent and single-session

Logging out twice returns 200. There is no useful sense in which the second call
failed, and an error would invite the frontend to leave stale tokens in storage.

It ends only the calling session — logging out on a laptop must not sign you out
on a phone. `deleteUserSessions` exists for log-out-everywhere and is used by
`createUser.js --force`, since a password reset that leaves old tokens working is
not a reset.

---

## Roadblocks hit, and what we did

### 1. The error handler dispatched on `err.status`, and `SocrataError` has one

The new 4xx branch in `app.js` matched on `err.status >= 400 && < 500`. But
`SocrataError.status` is the **upstream's** status, not ours. Two existing tests
went red — a Socrata 503 started returning `{"error": "socrata 503: down"}`
instead of `upstream_unavailable`.

The tests caught the 503 case. The dangerous one they did *not* cover is a
Socrata **400**, which would have forwarded Socrata's error body — SoQL query
text included — straight to the browser.

Fixed by dispatching on error **type**, never on a bare status number:
`SocrataError` first, then `instanceof HttpError || instanceof BadRequestError`.
The rule is now written in a comment at the top of the handler, because the
status collision is invisible until it bites.

### 2. `verifyPassword` returned `true` for a truncated hash

A stored hash ending in an empty key field (`scrypt$16384$8$1$aa$`) parsed
cleanly, produced `keyLength: 0`, and `timingSafeEqual` on two **empty buffers
returns true** — so a corrupt user document would have authenticated every
password for that user.

Caught by the malformed-input test, which existed because the function's
contract is "return false, never throw". Fixed with an explicit hex + non-empty
check on both fields before deriving.

Worth noting how narrow the escape was: the guard that saved this was written
for robustness, not security, and it caught a full authentication bypass.

### 3. Auth broke every existing route test

`routes.test.js` runs without Mongo on purpose — it asserts the frozen contract
shape against the committed baseline file, and its "exactly two upstream calls"
tests depend on there being no live cache. Requiring real tokens would have
dragged a mongod and an active cache into every one of those assertions.

Resolved by mocking the auth middleware there, exactly as that file already
mocks Socrata and the AI adapter, and proving the protection for real in
`auth.test.js` against a real mongod with real tokens. Both files carry a
comment pointing at the other; neither is complete alone.

### 4. Mongo stopped being optional

Every previous milestone treated Mongo as an optimisation — `cache.js` degrades
every failure to "miss" because a missing cache is only slow. Auth cannot do
that: an unreachable database during a login must not be read as "no such user"
(which looks like a wrong password) and must never be read as success.

So `mongo.js` grew a **second** accessor, `requireDb()`, which throws a 503
`auth_unavailable` where `getDb()` returns `null`. Both exist side by side, and
which one a provider calls is the statement of whether it can degrade. The cache
still uses `getDb()` and still degrades.

The consequence is that a teammate with no `MONGODB_URI` no longer gets a
working-but-uncached backend; they get a backend that refuses to start.
`docker compose up` already provides Mongo, so the documented path is unaffected.

---

## What Person 2 has to change

**`/api/score`, `/api/complaints`, and `/api/explanation` now return 401 without
a token.** Response shapes are otherwise **completely unchanged** — no field
added, removed, or renamed.

The integration is:

1. Log in once: `POST /api/auth/login {username, password}` → store
   `accessToken` and `refreshToken`.
2. Send `Authorization: Bearer <accessToken>` on every data request.
3. On a `401` with `error: "token_expired"`, call `POST /api/auth/refresh`
   with `{refreshToken}`, **store the new refreshToken** (the old one is now
   dead), and retry once.
4. On `401` `session_revoked` / `invalid_token` / `missing_token`, clear stored
   tokens and send the user to login.

`Access-Control-Allow-Headers` now includes `Authorization`, without which the
browser preflight would reject every authenticated cross-origin request before
sending it.

Getting an account:

```bash
# via the API — role is "tenant" or "landlord", required
curl -X POST localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"a good password","role":"tenant"}'

# or from the shell (also resets passwords with --force)
npm run user:create -- --username demo --password 'a good password' --role tenant
```

`user.role` is on every auth response and in the JWT payload, so the frontend
can render tenant vs landlord views without an extra call.

---

## What was verified

**Automated** — `npm test`, all passing, no network:

- 43 tests in `auth.test.js` against a real mongod over real HTTP: the full
  register/login/refresh/logout lifecycle, both roles round-tripping through the
  database and the token, all three protected routes 401ing without a token,
  forged-signature and `alg: none` rejection, expired-token handling, concurrent
  double-refresh, NoSQL-injection payloads, and that logout invalidates an
  otherwise-valid unexpired JWT.
- 9 tests in `password.test.js` on the hashing primitive, including the
  malformed-hash cases that caught roadblock 2.

**Live**, against a throwaway mongod, driving the real `src/index.js`:

- Boot guards exit 1 with usable instructions for missing/short `JWT_SECRET`
  and missing `MONGODB_URI`.
- `/health` 200 with no token; `/api/score` 401 with no token, 200 with one.
- `expiresIn: 604800` — exactly 7 days, confirmed on the wire.
- Refresh rotates; replaying the old refresh token 401s.
- After logout the same token returns `401 session_revoked` while the JWT itself
  is still unexpired and validly signed — the revocation design working as
  intended.
- `npm run user:create` creates an account the API accepts, and a duplicate
  registration returns 409.
- Both roles register and appear in the response, the JWT payload, and the
  stored document; a missing role 400s `missing_role` and `"broker"` 400s
  `invalid_role`.

---

## Known gaps

Named rather than hidden, for whoever picks this up:

- **No rate limiting on login.** Nothing stops offline-speed password guessing
  against the endpoint. scrypt makes each attempt cost ~80ms of *our* CPU, which
  is a weak brake and also a mild DoS surface. A per-IP limiter on
  `/api/auth/*` is the obvious next step and was left out as beyond "simple auth".
- **Registration is open.** Anyone who can reach the deployment can create an
  account. That was the explicit choice for demo convenience; `createUser.js`
  exists so the endpoint can be removed without losing the ability to make
  accounts.
- **Tokens are bearer tokens in a JS-readable store.** No httpOnly cookie, so
  XSS on the frontend means token theft. Cookies would need a CSRF story and a
  same-site decision that the current `Access-Control-Allow-Origin: *` does not
  support.
- **No password change / reset endpoint.** `npm run user:create --force` is the
  operator path.
- **No partly-public endpoint helper.** Every route is either fully open or
  behind `requireAuth`. An `optionalAuth` variant was written and then deleted
  in the cleanup pass — it had no caller and no test, and untested auth code is
  worse than no auth code. Reinstate it (with tests) if a route ever needs to
  serve both anonymous and signed-in callers.
