# Arcade Hackathon

**Memento** turns a written memory into a physical keepsake. Type a memory, and the app writes an
illustration prompt, generates the artwork through [Arcade AI](https://platform.arcade.ai), turns it
into a decorative pillow, and returns a checkout link.

Built with Next.js (App Router) + Tailwind CSS.

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

`POST /api/memento` streams newline-delimited JSON so the UI can show each stage while the pipeline
runs. Measured end to end: **roughly 50 seconds**.

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

## Running the demo

Serve from this laptop and expose it with a tunnel, so the ~50s pipeline is not capped by a platform
timeout:

```bash
npm run dev
npx localtunnel --port 3000     # or: ngrok http 3000
```

Keep `ARCADE_MOCK="fallback"` in `.env.local` for the demo. If Arcade is slow on the day, the pitch
still lands on a mock pillow instead of an error, and the buy button is labelled as a demo so nobody
clicks a fake checkout.

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
    page.tsx                 # the whole UI: textarea, staged progress, result card
    layout.tsx
    globals.css
    api/memento/route.ts     # streams the pipeline as NDJSON
  lib/
    env.ts                   # server-only env parsing with defaults
    llm.ts                   # generateImagePrompt(memory)
    arcade.ts                # pattern -> product -> preview -> checkout, with polling and mock fallback
```
