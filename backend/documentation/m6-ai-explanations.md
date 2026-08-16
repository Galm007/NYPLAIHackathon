# M6 — AI explanation layer (P3.5)

**Status:** complete and verified live against both adapters.
**Covers:** `src/providers/ai/*`, `src/services/explain.js`,
`src/services/templateExplanation.js`, `GET /api/explanation`, the explanation
fields on `POST /api/score`, and `scripts/verifyExplanations.js`.

## Goal

Each sub-score gets a 1–2 sentence plain-English explanation of why it landed in
its band, without the AI call ever being able to slow down or break the score.

## What was built

| File | Role |
| --- | --- |
| `providers/ai/prompt.js` | `buildPrompt()` — **shared by both adapters** |
| `providers/ai/ollama.js` | Local dev adapter (`localhost:11434`) |
| `providers/ai/gemini.js` | Deployed adapter (hosted HTTP, serverless-safe) |
| `providers/ai/index.js` | Factory on `AI_PROVIDER`; the only file that branches on it |
| `providers/ai/shared.js` | `AIError`, `cleanExplanation()` output normalisation |
| `services/templateExplanation.js` | Deterministic fallback, cannot fail |
| `services/explain.js` | Wraps the adapter; guarantees the fallback |
| `routes/explanation.js` | `GET /api/explanation` — the slow path |
| `scripts/verifyExplanations.js` | `npm run verify:explanations` — tone check |

**299 tests passing** (was 209 before this milestone), still no network in any of
them — both adapters and the route suite mock the AI.

## The two-call pattern

```
POST /api/score          ~95ms   →  template text, explanationSource: "template"
GET  /api/explanation    ~2.4s   →  AI text, explanationSource: "ai", cached
POST /api/score  (again)  ~2ms   →  the cached AI text, explanationSource: "ai"
GET  /api/explanation    ~16ms   →  cached, no regeneration
```

Measured locally, llama3.1:8b. The score request **never** calls the AI — not
even in the background. On a cache miss it serves the deterministic template
immediately and the frontend fires the second call to upgrade it in place.

That split is what solves the serverless timeout risk: the slow AI call gets its
own request budget instead of stacking behind Socrata (1.6–2.5s cold) plus
scoring on the one request a user is waiting on.

## Caching

The explanation is stored on the **same `complaint_cache` document** as the
counts it describes, under `explanation` / `explanationSource` / `explanationAt`.

Consequences worth knowing:

- **One TTL, one lifetime.** The counts and the sentence about them expire
  together, so they cannot disagree.
- **Refreshing counts drops the explanation.** `writeCounts` uses `replaceOne`,
  so a refreshed document has no explanation and the next request regenerates.
  That is correct: text written about last week's counts must not survive onto
  this week's.
- **`writeExplanation` does not touch `createdAt`.** Refreshing it there would
  let a frequently-explained address keep stale counts alive indefinitely.
- **`upsert: false`.** If the counts have expired there is nothing for the
  explanation to belong to, and a bare explanation document would be rejected by
  `readEntries` as incomplete anyway.
- **Only `"ai"` output is cached.** A cached template would be worthless (it is
  free to rebuild) and actively harmful — `/api/score` would report
  `explanationSource: "ai"` and the frontend would skip its second call forever.

## Fallback

`services/explain.js` catches everything and returns a template. Tested against
timeouts, rate limits, connection refused, empty responses, unknown providers,
and non-`Error` throws. There is no path where a user sees an error from this
feature — the endpoint returns 200 with template text and says so honestly in
`explanationSource`.

One deliberate extra: **the AI is skipped entirely when every count is zero.**
Asking anyway produced actively wrong output from llama3.1:8b:

> "there were no complaints filed about unsanitary conditions or plumbing issues
> during this time period, **suggesting that these aspects of the building may be
> areas of concern**"

Zero complaints described as a concern is worse than no AI at all — and this is
exactly the case already flagged `confidence: "low"` because the coordinate may
have missed its building. The template says the honest thing instead.

## The prompt

One shared prompt, no per-adapter forks. Rules, and why each exists:

| Rule | Why |
| --- | --- |
| Use only the given numbers; do not invent addresses, dates, landlords, incidents | The main hallucination defense. An invented specific in a renting decision is the worst thing this feature could emit |
| Do not calculate ratios, percentages, or "X times more" | llama3.1 called 2876-vs-1253 "nearly three times as many". It is 2.3×. Models do arithmetic badly and a wrong ratio is a factual error |
| Never use percentile / score / baseline / median / dataset | The user is reading a rating, not a methodology |
| Max 2 sentences | Llama ran to three; Gemini stayed at two |
| Do not state the rating word or repeat the city comparison | Gemini appended "This puts the block rating at poor, which is worse than most of New York City" |
| Do not quote the counts | Gemini emitted `"5 heat and hot water", "0 unsanitary conditions"` |
| Do not begin with "The \<score name\>" | Llama opened with "The Building Health rating indicates that…" every time until the bad opening was named explicitly |

The last three exist purely to stop the two models drifting apart. CLAUDE.md is
explicit that divergence should be fixed in `prompt.js`, not patched per adapter,
and that is what was done.

Bucket keys never reach the model — `heatHotWater` is sent as "heat and hot
water". Bands are sent as meaning, not as the raw word: `poor` becomes "worse
than most of New York City".

## Model findings — both spec assumptions were wrong

### Gemini: `gemini-2.5-flash-lite` is already unavailable

CLAUDE.md flags a 2026-10-16 shutdown and treats the model as fine until then.
Verified live on 2026-08-15 with a working key:

```
404  "This model models/gemini-2.5-flash-lite is no longer available to new users."
```

It is listed by the models endpoint but rejects new callers **now**, not in
October. Swapped to **`gemini-3.5-flash-lite`** — same product tier, currently
available, ~0.7–0.9s.

This is the scenario CLAUDE.md's deprecation note anticipated, including its
instruction to "confirm that's actually how it's wired before relying on it".
It was wired that way: the fix was one constant.

### Gemini: the thinking budget is model-dependent, and silently truncates

Measured against the real prompt at `maxOutputTokens: 120`:

| Model | `thinkingConfig` | Result |
| --- | --- | --- |
| `gemini-3.5-flash-lite` | omitted | 200, clean 2 sentences, 61 output tokens |
| `gemini-3.5-flash-lite` | `thinkingBudget: 0` | **400 invalid argument** |
| `gemini-2.5-flash` | `thinkingBudget: 0` | 200, fine |
| `gemini-2.5-flash` | omitted | **200 with the text "Living here, you would"** — 111 thinking tokens ate the cap, `finishReason: MAX_TOKENS` |

That last row is the dangerous one: a **200 response containing a truncated
fragment**, not an error. Handled three ways:

1. `GEMINI_THINKING_BUDGET` is a constant, `null` by default (field omitted).
2. A 400 while sending `thinkingConfig` retries once without it, so changing
   `GEMINI_MODEL` degrades instead of breaking.
3. `MAX_TOKENS` with no text and non-zero `thoughtsTokenCount` produces an error
   naming the fix, rather than the uninterpretable string "MAX_TOKENS".

### Ollama: the spec's model is not what is installed

CLAUDE.md specifies `llama3`. The dev machine has `llama3.1:8b` and not
`llama3`, so that is the default in `constants.js` — one constant or one env var
(`OLLAMA_MODEL`) to change back. Nothing else in the codebase knows a model name.

## Tone consistency (`npm run verify:explanations`)

The check CLAUDE.md requires before demo day: both adapters, same fixed inputs,
outputs side by side with the template, plus automated warnings for leaked
technical terms, derived arithmetic, foreign numbers, and over-length output.

After the prompt was tightened, on the same "loud Bushwick block" input:

> **ollama** (2.7s) — Noise complaints are extremely high in this area, with 2876
> filed in the last 24 months. Additionally, there have been 1253 reports of
> illegal parking and blocked driveways, which could make navigating the
> neighborhood challenging.
>
> **gemini** (0.9s) — Residents on this block will notice high volumes of
> disturbances, with 2876 noise complaints, 1253 illegal parking and blocked
> driveways complaints, and 144 street and sidewalk condition complaints filed
> over the last 24 months.

Close enough to read as one product. Residual differences, neither blocking:

- **Gemini is 3× faster** (0.7–0.9s vs 2.2–2.9s) and more clinical; Llama is
  more conversational ("You can expect to…").
- **Llama occasionally adds an ungrounded qualifier** — "which is a relatively
  low number considering the size of this building", when we never told it the
  size. Not an invented specific (no address, no date), but it is the 8B model
  reaching. Gemini has not done this.
- Llama has produced a typo ("Unsantary") once in ~20 generations.

Re-run this after any prompt change, and once more before demo day.

## Deviations from CLAUDE.md, and why

| Spec says | Built | Reason |
| --- | --- | --- |
| `gemini-2.5-flash-lite` | `gemini-3.5-flash-lite` | The spec's model 404s for new keys today |
| model `llama3` | `llama3.1:8b` | It is what is pulled locally; one env var to change |
| `providers/db.js` | existing `providers/mongo.js` | The connection provider already existed under that name from M3; renaming it would touch every layer for no behavioural gain |
| `GET /api/explanation` returns `explanationSource: "ai"` | may also return `"template"` | The fallback is mandatory, so the field must be able to report it. Always 200 either way |

## What is NOT done

- **`AI_PROVIDER=gemini` has not been run through the deployed Vercel path** —
  only against the live API from local Node. The adapter is HTTP-only and
  stateless, so there is no known serverless blocker, but it is untested there.
- **No pre-warming of explanations.** M6/P5 should generate explanations for the
  demo addresses at pre-warm time so the demo never shows template text.
- **No rate-limit accounting for Gemini.** CLAUDE.md open item 6 (free-tier
  RPM/RPD caps) is still unverified against Google's pricing page. The cache
  keeps volume low, and a 429 degrades to the template, so this is a cost/limits
  question rather than a correctness one.
