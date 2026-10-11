"use client";

import { useRef, useState } from "react";

type Stage = "pattern" | "product" | "preview" | "checkout";

type Product = {
  mock: boolean;
  patternId?: string;
  productId?: string;
  title?: string;
  selectionLabel?: string;
  previewImageUrl?: string;
  images?: string[];
  checkoutId?: string;
  checkoutUrl: string;
  elapsedMs: number;
  fallbackReason?: string;
};

type Result = { imagePrompt: string; product: Product };

type StreamLine =
  | { type: "progress"; stage: Stage; message: string }
  | { type: "done"; imagePrompt: string; product: Product }
  | { type: "error"; message: string };

const STAGES: { key: Stage; label: string }[] = [
  { key: "pattern", label: "Illustration" },
  { key: "product", label: "Pillow" },
  { key: "preview", label: "Preview" },
  { key: "checkout", label: "Checkout" },
];

const EXAMPLE =
  "Every summer my grandmother and I picked blackberries behind the old barn, and she'd make jam in a copper pot while the radio played.";

export default function Home() {
  const [memory, setMemory] = useState("");
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const tooShort = memory.trim().length > 0 && memory.trim().length < 10;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const trimmed = memory.trim();
    if (trimmed.length < 10) {
      setError("Please describe the memory in at least 10 characters.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setResult(null);
    setStage(null);
    setStatus("Reading your memory…");

    try {
      const response = await fetch("/api/memento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory: trimmed }),
        signal: controller.signal,
      });

      // Validation and other pre-stream failures come back as plain JSON.
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Request failed with ${response.status}.`);
      }
      if (!response.body) throw new Error("The server returned an empty response.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (; ;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamLine;

          if (event.type === "progress") {
            setStage(event.stage);
            setStatus(event.message);
          } else if (event.type === "done") {
            setResult({ imagePrompt: event.imagePrompt, product: event.product });
            setStage(null);
            setStatus("");
          } else {
            throw new Error(event.message);
          }
        }
      }
    } catch (caught) {
      if ((caught as Error).name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setStage(null);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const activeIndex = stage ? STAGES.findIndex((item) => item.key === stage) : -1;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14 sm:py-20">
      <header className="mb-10">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-stone-500">
          Memento
        </p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-stone-900 sm:text-5xl">
          Turn a memory into something you can hold.
        </h1>
        <p className="mt-4 max-w-xl text-stone-600">
          Describe a moment. We illustrate it, print it onto a handcrafted pillow, and hand you a
          checkout link.
        </p>
      </header>

      <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <label htmlFor="memory" className="block text-sm font-medium text-stone-700">
          What do you remember?
        </label>
        <textarea
          id="memory"
          value={memory}
          onChange={(event) => setMemory(event.target.value)}
          rows={5}
          maxLength={1000}
          placeholder={EXAMPLE}
          disabled={busy}
          className="mt-3 w-full resize-y rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-stone-900 outline-none transition focus:border-stone-400 focus:bg-white disabled:opacity-60"
        />

        <div className="mt-3 flex items-center justify-between gap-4">
          <span className="text-xs text-stone-400">
            {memory.trim().length}/1000
            {tooShort && " · needs at least 10"}
          </span>
          <button
            type="submit"
            disabled={busy || memory.trim().length < 10}
            className="rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Working…" : "Create my keepsake"}
          </button>
        </div>
      </form>

      {busy && (
        <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-stone-800">{status || "Working…"}</p>
          <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STAGES.map((item, index) => {
              const done = activeIndex > index;
              const active = activeIndex === index;
              return (
                <li
                  key={item.key}
                  className={`rounded-lg border px-3 py-2 text-xs transition ${active
                    ? "border-stone-900 bg-stone-900 text-white"
                    : done
                      ? "border-stone-300 bg-stone-100 text-stone-600"
                      : "border-stone-200 text-stone-400"
                    }`}
                >
                  {item.label}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {result && (
        <section className="mt-6 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {result.product.previewImageUrl && (
            // Remote host varies by Arcade environment, so skip next/image optimisation.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.product.previewImageUrl}
              alt="Illustration generated from your memory, printed on a pillow"
              className="aspect-square w-full bg-stone-100 object-cover"
            />
          )}

          <div className="space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">
                {result.product.title ?? "Your keepsake"}
              </h2>
              <p className="text-sm text-stone-500">
                {result.product.selectionLabel ?? "Handcrafted by an independent maker"}
                {result.product.elapsedMs > 0 && ` · made in ${Math.round(result.product.elapsedMs / 1000)}s`}
              </p>
            </div>

            {result.product.mock && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <strong className="font-semibold">Demo preview.</strong> The live product service did
                not return a result{result.product.fallbackReason ? ` (${result.product.fallbackReason.slice(0, 120)})` : ""}, so
                this is placeholder artwork and the checkout link is not a real order.
              </p>
            )}

            <details className="text-sm">
              <summary className="cursor-pointer text-stone-500">Illustration prompt</summary>
              <p className="mt-2 whitespace-pre-wrap text-stone-700">{result.imagePrompt}</p>
            </details>

            {result.product.mock ? (
              <span className="inline-block rounded-xl bg-stone-200 px-5 py-2.5 text-sm font-medium text-stone-500">
                Buy (demo — not a real order)
              </span>
            ) : (
              <a
                href={result.product.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700"
              >
                Buy this pillow →
              </a>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
