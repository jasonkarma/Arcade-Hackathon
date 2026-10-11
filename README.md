# Weft

**Weft** turns written sentiment into a physical keepsake. Submit a cherished memory, favorite quote,
or inside joke, and Weft translates it into an illustration prompt, generates the artwork through
[Arcade AI](https://platform.arcade.ai), applies it to a decorative pillow, and returns a checkout
link.

**Live website:** [arcade-hackathon-production.up.railway.app](https://arcade-hackathon-production.up.railway.app/)

Built with Next.js 16 (App Router), React 19, and Tailwind CSS 4. Hosted on
[Railway](https://railway.com/).

## Experience

- A focused sentiment composer for submissions between 10 and 1,000 characters.
- A three-phase atelier loading experience with a glowing dial, live phase badge, and the submitted
  sentiment displayed as an elegant serif quotation.
- Streaming progress while Weft synthesizes the visual sentiment, creates the physical weave, and
  mints the Arcade checkout.
- A finished artifact view with the generated product preview, maker details, generative trace, and
  checkout link.
- A transparent demo fallback when Arcade cannot return a live product in time.

## How it works

```
memory -> OpenAI-compatible LLM -> image prompt
       -> POST /v1/patterns/create    (job)
       -> POST /v1/jobs/get           (poll)
       -> POST /v1/products/create    (job)
       -> POST /v1/jobs/get           (poll)
       -> POST /v1/products/get       (preview image)
       -> POST /v1/checkouts/create   (checkout link)
```

`POST /api/memento` streams newline-delimited JSON so the UI can advance through its three atelier
phases while the pipeline runs. A live request usually completes in under ninety seconds.

## Getting started

Requires Node.js 20.9+ (this project was set up on Node 22).

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev                  # http://localhost:3000
```

## Environment variables

All variables are server-side only. Never prefix them with `NEXT_PUBLIC_`.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ARCADE_API_KEY` | yes | – | Arcade AI secret key (`arcade_sk_live_...`) |
| `ARCADE_API_BASE_URL` | no | `https://platform.arcade.ai` | `/v1` is appended by the client |
| `ARCADE_USER_AGENT` | no | `memento/1.0` | Sent on every Arcade request |
| `ARCADE_REQUEST_TIMEOUT_MS` | no | `30000` | Per-request timeout |
| `ARCADE_POLL_INTERVAL_MS` | no | `2500` | Job poll interval |
| `PIPELINE_BUDGET_MS` | no | `90000` | One deadline for the LLM call plus the whole Arcade pipeline; must stay under the route's `maxDuration` |
| `ARCADE_PILLOW_CATEGORY_ID` | no | `0ef267de-...` | "Decorative Pillows" |
| `ARCADE_PILLOW_FABRIC` | no | `canvas` | `canvas`, `fine_cotton`, `linen`, `soft_linen`, `cotton_velvet` |
| `ARCADE_PILLOW_SIZE` | no | `18x18` | Any size from `POST /v1/categories/get` |
| `ARCADE_PILLOW_EMBELLISHMENT` | no | `none` | `none`, `piping`, `tassels`, `piping_and_tassels`, `eyelash_fringe` |
| `ARCADE_PILLOW_INSERT` | no | `none` | `none` or `microfiber` |
| `ARCADE_MOCK` | no | `fallback` | See below |
| `OPENAI_API_KEY` | yes | – | Key for the image-prompt LLM |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | Any OpenAI-compatible chat model |
| `OPENAI_BASE_URL` | no | `https://api.openai.com/v1` | Point at any OpenAI-compatible endpoint (Gemini, OpenRouter, local) |
| `LLM_TIMEOUT_MS` | no | `30000` | Prompt-generation timeout |

### Mock mode

| Value | Behaviour |
| --- | --- |
| `true` | Never calls Arcade. Returns a placeholder product and checkout link. Use while working on the UI. |
| `fallback` | Calls Arcade, but on any failure, timeout, or exhausted `PIPELINE_BUDGET_MS` returns a mock product instead of hanging. **Recommended for a live demo.** |
| `false` | Strict. Real errors are surfaced. Use while integrating and debugging. |

`ARCADE_MOCK` only short-circuits Arcade. The LLM call still runs, so a real image prompt is always
produced. With `ARCADE_MOCK=true` a request completes in about 1.5s: prompt generated, Arcade skipped.

When a mock result is returned, `product.mock` is `true` and the UI labels the buy button as a demo
so nobody is sent to a fake checkout.

## API

`POST /api/memento` with `{ "memory": "..." }` (10-1000 characters) returns a stream of NDJSON lines:

```jsonc
{"type":"progress","stage":"pattern","message":"Illustrating your memory…"}
{"type":"progress","stage":"product","message":"Building your pillow…"}
{"type":"done","imagePrompt":"...","product":{"checkoutUrl":"...","previewImageUrl":"...","mock":false,"elapsedMs":48888}}
{"type":"error","message":"..."}
```

Validation errors return a plain JSON `{ error }` with status 400. Mid-pipeline failures arrive as an
`error` line on the stream, because the response has already started.

Measured end to end: **49-55 seconds** (pattern ~24s, product ~12-18s, preview and checkout ~1s each).
`GET` returns 405.

## Deployment

The production website is deployed on Railway:

[https://arcade-hackathon-production.up.railway.app/](https://arcade-hackathon-production.up.railway.app/)

Railway builds and starts the app with the scripts in `package.json`. Configure the environment
variables listed above in the Railway service, use Node.js 20.9 or newer, and keep the route timeout
long enough for the configured `PIPELINE_BUDGET_MS`.

Keep `ARCADE_MOCK="fallback"` enabled for public demos. If Arcade is temporarily slow, Weft still
lands on a clearly labelled mock pillow instead of leaving the visitor on an error screen, and the
checkout action remains disabled.

To verify the real path before going on stage, set `ARCADE_MOCK="false"`, run one memory through, and
check that `checkoutUrl` points at `checkout.arcade.ai`.

## Notes on the Arcade API

Endpoints confirmed by hand against `https://platform.arcade.ai`:

- `POST /v1/categories/list` — categories and their IDs. `Decorative Pillows` is
  `0ef267de-f8c2-4a93-89a3-63be809f68e2`.
- `POST /v1/categories/get` — `{ categoryId }`. Returns `options` (valid selection keys and values)
  plus the category defaults.
- `POST /v1/patterns/create` — `{ prompt }`. Returns `{ jobId, status }`.
- `POST /v1/products/create` — `{ patternId, categoryId, selections }`. `selections` is required and
  every key must exist in the category's `options`, otherwise you get a 400 or 422.
- `POST /v1/products/get` — `{ productId }`. Returns `title`, `selectionLabel`, `imageUrl`, `images`.
- `POST /v1/checkouts/create` — `{ dropShip: true, lines: [{ productId, quantity }] }`. Without
  `dropShip: true` a single-unit line is rejected with `412 PRECONDITION_FAILED`.
- `POST /v1/jobs/get` — `{ jobId }`. Poll until `status` is `succeeded` or `failed`; IDs live in
  `result.patternId` / `result.productId`.

Every request carries a fresh `requestId` (a UUID) so retries cannot duplicate a job.

## Project layout

```
src/
  app/
    page.tsx                 # Weft UI: sentiment form, atelier loading phases, result card
    ambient-background.tsx  # animated atmospheric background
    layout.tsx
    globals.css
    api/memento/route.ts     # streams the pipeline as NDJSON
  lib/
    env.ts                   # server-only env parsing with defaults
    llm.ts                   # generateImagePrompt(memory)
    arcade.ts                # pattern -> product -> preview -> checkout, with polling and mock fallback
```
