"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { AmbientBackground } from "./ambient-background";

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

type View = "idle" | "loading" | "success";

const PHASES = [
    "Reading the emotional signal",
    "Synthesizing visual sentiment",
    "Interlocking weave & minting checkout",
] as const;

const FADE_MS = 700;
const MIN_LENGTH = 10;

function phaseForStage(stage: Stage): number {
    return stage === "pattern" ? 1 : 2;
}

function Mark() {
    return (
        <div className="flex items-center gap-3" aria-label="Weft">
            <span className="relative grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                <span className="absolute size-3.5 animate-ping rounded-full bg-amber-300/15" />
                <span className="size-2 rounded-full bg-gradient-to-br from-amber-200 to-orange-400 shadow-[0_0_16px_rgba(245,208,169,0.65)]" />
            </span>
            <span className="text-sm font-medium tracking-widest text-white">Weft</span>
        </div>
    );
}

export default function Home() {
    const [memory, setMemory] = useState("");
    const [phase, setPhase] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<Result | null>(null);
    const [view, setView] = useState<View>("idle");
    const [visible, setVisible] = useState(true);

    const abortRef = useRef<AbortController | null>(null);
    const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        sessionStorage.removeItem("memento:chunk-recovery");
        console.info("[memento:diagnostic] React hydration active", {
            origin: window.location.origin,
            readyState: document.readyState,
        });

        const reportResourceFailure = (event: ErrorEvent) => {
            const target = event.target;
            if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
                console.error("[memento:diagnostic] resource failed after hydration", {
                    url: target instanceof HTMLScriptElement ? target.src : target.href,
                    tagName: target.tagName,
                });
            }
        };

        window.addEventListener("error", reportResourceFailure, true);
        return () => window.removeEventListener("error", reportResourceFailure, true);
    }, []);

    useEffect(() => {
        console.info("[memento:diagnostic] sentiment gate", {
            length: memory.trim().length,
            requiredLength: MIN_LENGTH,
            busy,
            unlocked: !busy && memory.trim().length >= MIN_LENGTH,
        });
    }, [busy, memory]);

    useEffect(
        () => () => {
            if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
            abortRef.current?.abort();
        },
        [],
    );

    function goTo(next: View) {
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        setVisible(false);
        fadeTimerRef.current = setTimeout(() => {
            setView(next);
            setVisible(true);
            fadeTimerRef.current = null;
        }, FADE_MS);
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        console.info("[memento] React submit handler reached");
        if (busy) return;

        // Read from the form so browser autofill and automation-inserted text are
        // captured even when they do not dispatch React's change event.
        const formData = new FormData(event.currentTarget as HTMLFormElement);
        const trimmed = String(formData.get("sentiment_input") ?? memory).trim();
        if (trimmed.length < MIN_LENGTH) {
            setError(`Please describe the memory in at least ${MIN_LENGTH} characters.`);
            return;
        }

        setMemory(trimmed);

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        setError(null);
        setPhase(0);
        goTo("loading");

        try {
            const response = await fetch("/api/memento", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memory: trimmed }),
                signal: controller.signal,
            });

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
                    const streamEvent = JSON.parse(line) as StreamLine;
                    if (streamEvent.type === "progress") {
                        setPhase((current) => Math.max(current, phaseForStage(streamEvent.stage)));
                    } else if (streamEvent.type === "done") {
                        setResult({ imagePrompt: streamEvent.imagePrompt, product: streamEvent.product });
                        goTo("success");
                    } else {
                        throw new Error(streamEvent.message);
                    }
                }
            }
        } catch (caught) {
            if ((caught as Error).name === "AbortError") return;
            setError(caught instanceof Error ? caught.message : "Something went wrong.");
            goTo("idle");
        } finally {
            setBusy(false);
        }
    }

    function startOver() {
        setError(null);
        setPhase(0);
        goTo("idle");
        setTimeout(() => setResult(null), FADE_MS);
    }

    return (
        <main className="relative isolate min-h-svh overflow-hidden bg-[#09080b] text-white selection:bg-amber-300/30">
            <AmbientBackground />

            <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-7xl flex-col px-5 sm:px-8 lg:px-12">
                <nav className="flex items-center justify-between py-6 sm:py-8">
                    <Mark />
                    <div className="hidden items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500 sm:flex">
                        <span className="size-1.5 animate-pulse rounded-full bg-amber-400/80 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                        Ready to craft
                    </div>
                </nav>

                <div
                    className={`flex flex-1 items-center py-10 transition-all duration-700 ease-out ${visible ? "scale-100 opacity-100 blur-0" : "scale-95 opacity-0 blur-sm"
                        }`}
                >
                    {view === "idle" && (
                        <section className="animate-in fade-in zoom-in-95 grid w-full gap-12 duration-700 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-20">
                            <header>
                                <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-400 backdrop-blur-xl">
                                    <span className="text-amber-200">✦</span> Bespoke textile atelier
                                </div>
                                <h1 className="max-w-3xl font-sans text-5xl font-medium leading-[0.96] tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl xl:text-[5.4rem]">
                                    <span>Give your words </span>
                                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-200 via-orange-300 to-amber-400">a physical form.</span>
                                </h1>
                                <p className="mt-7 max-w-xl text-base leading-7 text-neutral-400 sm:text-lg">
                                    A cherished memory, a favorite quote, or an inside joke. Our sentiment engine crafts
                                    bespoke woven heirlooms from whatever matters to you.
                                </p>
                                <div className="mt-9 flex items-center gap-6 text-xs text-neutral-500">
                                    <span className="flex items-center gap-2">
                                        <span className="h-px w-6 bg-gradient-to-r from-amber-300 to-transparent" />
                                        Unique to you
                                    </span>
                                    <span className="flex items-center gap-2">
                                        <span className="h-px w-6 bg-gradient-to-r from-orange-400 to-transparent" />
                                        Made tangible
                                    </span>
                                </div>
                            </header>

                            <div>
                                <form
                                    onSubmit={submit}
                                    className="group rounded-2xl border border-white/10 bg-stone-900/40 p-2 shadow-[0_8px_32px_0_rgba(0,0,0,0.36)] backdrop-blur-xl transition-all duration-500 focus-within:border-amber-100/20 focus-within:shadow-[0_0_30px_rgba(184,92,56,0.16),0_8px_32px_rgba(0,0,0,0.36)]"
                                >
                                    <div className="rounded-xl border border-white/[0.06] bg-black/20 p-5 sm:p-6">
                                        <label htmlFor="sentiment_input" className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500">
                                            <span>Your sentiment</span>
                                            <span className="flex items-center gap-1.5 text-amber-200/70">
                                                <span className="size-1 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(245,208,169,0.7)]" />
                                                Listening
                                            </span>
                                        </label>
                                        <textarea
                                            id="sentiment_input"
                                            name="sentiment_input"
                                            autoComplete="off"
                                            autoCorrect="off"
                                            spellCheck="false"
                                            value={memory}
                                            onChange={(event) => {
                                                console.info("[memento] React input event", { length: event.target.value.length });
                                                setMemory(event.target.value);
                                            }}
                                            rows={7}
                                            minLength={MIN_LENGTH}
                                            required
                                            maxLength={1000}
                                            placeholder="A favorite quote, a childhood memory, wedding vows, or an unforgettable night..."
                                            readOnly={busy}
                                            aria-disabled={busy}
                                            className="mt-5 w-full resize-none border-0 bg-transparent p-0 text-base leading-7 text-neutral-200 outline-none placeholder:text-neutral-600 focus:ring-0 read-only:cursor-wait read-only:opacity-50 sm:text-lg"
                                        />
                                        <div className="mt-5 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                                        <div className="mt-5 flex items-center justify-end gap-4">
                                            <button
                                                type="submit"
                                                disabled={busy || memory.trim().length < MIN_LENGTH}
                                                className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-r from-amber-100 to-amber-200 px-5 py-3 text-sm font-medium text-stone-950 shadow-[0_0_20px_rgba(245,208,169,0.25)] transition-all duration-300 hover:scale-[1.02] hover:from-white hover:to-amber-100 disabled:cursor-not-allowed disabled:from-white/10 disabled:to-white/10 disabled:text-neutral-600 disabled:shadow-none disabled:hover:scale-100"
                                            >
                                                <span className="relative flex items-center gap-2">
                                                    Craft Keepsake <span aria-hidden="true">↗</span>
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                </form>

                                {error && (
                                    <p role="alert" className="animate-in fade-in zoom-in-95 mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200 backdrop-blur-xl duration-700">
                                        {error}
                                    </p>
                                )}
                            </div>
                        </section>
                    )}

                    {view === "loading" && (
                        <section aria-live="polite" className="animate-in fade-in zoom-in-95 mx-auto flex w-full max-w-2xl flex-col items-center text-center duration-700">
                            <div className="relative grid size-36 place-items-center">
                                <div className="absolute inset-0 animate-spin rounded-full bg-[conic-gradient(from_0deg,transparent_0_20%,rgba(200,168,118,.8)_45%,transparent_70%)] p-px [animation-duration:3s]">
                                    <div className="size-full rounded-full bg-[#09080b]/90" />
                                </div>
                                <div className="absolute inset-4 animate-pulse rounded-full border border-amber-300/20 shadow-[0_0_40px_rgba(200,168,118,0.18),inset_0_0_30px_rgba(184,93,56,0.08)]" />
                                <span className="size-2 rounded-full bg-amber-200 shadow-[0_0_24px_rgba(245,208,169,0.8)]" />
                            </div>
                            <p className="mt-8 rounded-full border border-amber-200/15 bg-amber-200/[0.06] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-amber-200">
                                0{phase + 1} / 0{PHASES.length} — Atelier loom active
                            </p>
                            <blockquote className="my-8 max-w-2xl text-center font-serif text-xl italic leading-relaxed text-stone-300/90 drop-shadow-md shadow-black/50">
                                &ldquo;{memory}&rdquo;
                            </blockquote>
                            <h2 key={phase} className="animate-in fade-in zoom-in-95 text-3xl font-medium text-white duration-700">
                                {PHASES[phase]}
                            </h2>
                            <p className="mt-4 max-w-md text-sm leading-6 text-neutral-500">
                                Your sentiment is being translated into color, form, and material. Complex pieces can take several minutes.
                            </p>
                        </section>
                    )}

                    {view === "success" && result && (
                        <section className="animate-in fade-in zoom-in-95 mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-white/[0.05] shadow-[0_40px_140px_rgba(0,0,0,0.65)] backdrop-blur-2xl duration-700 md:grid-cols-[1.05fr_0.95fr]">
                            <div className="relative min-h-80 overflow-hidden bg-black/40 md:min-h-[34rem]">
                                {result.product.previewImageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={result.product.previewImageUrl} alt="AI artwork generated from your memory, presented on a pillow" className="h-full w-full object-cover transition-transform duration-700 hover:scale-[1.025]" />
                                ) : (
                                    <div className="grid h-full place-items-center text-sm text-neutral-600">Preview unavailable</div>
                                )}
                                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-amber-200/10" />
                                <div className="absolute left-5 top-5 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/70 backdrop-blur-xl">
                                    Synthesis complete
                                </div>
                            </div>

                            <div className="flex flex-col p-7 sm:p-9">
                                <div className="mb-8 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-amber-200/80">
                                    <span className="size-1.5 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(245,208,169,0.65)]" />
                                    Artifact ready
                                </div>
                                <h2 className="text-3xl font-medium tracking-tight text-white sm:text-4xl">
                                    {result.product.title ?? "Your memory, made tangible"}
                                </h2>
                                <p className="mt-3 text-sm leading-6 text-neutral-400">
                                    {result.product.selectionLabel ?? "Crafted by an independent maker"}
                                    {result.product.elapsedMs > 0 && ` · synthesized in ${Math.round(result.product.elapsedMs / 1000)}s`}
                                </p>

                                {result.product.mock && (
                                    <p className="mt-6 rounded-xl border border-orange-400/20 bg-orange-400/[0.08] p-4 text-xs leading-5 text-orange-100/70">
                                        <strong className="font-medium text-orange-200">Demo preview.</strong> The live product service did not return a result{result.product.fallbackReason ? ` (${result.product.fallbackReason.slice(0, 120)})` : ""}, so this checkout is disabled.
                                    </p>
                                )}

                                <details className="group mt-7 border-y border-white/[0.07] py-4 text-sm">
                                    <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500 transition-colors hover:text-neutral-300">
                                        Generative trace <span className="text-base transition-transform group-open:rotate-45">+</span>
                                    </summary>
                                    <p className="mt-4 max-h-32 overflow-y-auto whitespace-pre-wrap pr-2 text-xs leading-5 text-neutral-500">{result.imagePrompt}</p>
                                </details>

                                <div className="mt-auto flex flex-col gap-3 pt-8">
                                    {result.product.mock ? (
                                        <span className="rounded-xl border border-white/[0.06] bg-white/[0.05] px-5 py-3.5 text-center text-sm font-medium text-neutral-600">Checkout unavailable in demo</span>
                                    ) : (
                                        <a href={result.product.checkoutUrl} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-gradient-to-r from-amber-100 to-amber-200 px-5 py-3.5 text-center text-sm font-medium text-stone-950 shadow-[0_0_20px_rgba(245,208,169,0.25)] transition-all duration-300 hover:scale-[1.01] hover:from-white hover:to-amber-100 hover:shadow-[0_0_30px_rgba(245,208,169,0.3)]">
                                            Make it yours ↗
                                        </a>
                                    )}
                                    <button type="button" onClick={startOver} className="rounded-xl px-5 py-3 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500 transition-colors hover:text-white">
                                        Create another memory
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}
                </div>

                <footer className="flex items-center justify-between border-t border-white/[0.06] py-5 text-[10px] uppercase tracking-[0.16em] text-neutral-700">
                    <span>Sentiment → Matter</span>
                    <a
                        href="https://platform.arcade.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] uppercase tracking-[0.2em] text-stone-500 transition-colors hover:text-stone-300"
                    >
                        Powered by Arcade
                    </a>
                </footer>
            </div>
        </main>
    );
}
