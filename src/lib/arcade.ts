import "server-only";
import { arcadeConfig } from "./env";

export type Stage = "pattern" | "product" | "preview" | "checkout";

export type ProgressEvent = {
    stage: Stage;
    message: string;
};

export type ProgressCallback = (event: ProgressEvent) => void;

export type PipelineOptions = {
    /** Absolute timestamp (ms) by which the whole request must finish. */
    deadline?: number;
    onProgress?: ProgressCallback;
};

export type ProductResult = {
    /** True when this result came from ARCADE_MOCK=true or the fallback path. */
    mock: boolean;
    patternId?: string;
    productId?: string;
    title?: string;
    selectionLabel?: string;
    /** The rendered pillow mockup: imageUrl from /v1/products/get. */
    previewImageUrl?: string;
    /** Additional views, e.g. the close-up shot. */
    images?: string[];
    checkoutId?: string;
    checkoutUrl: string;
    /** Wall-clock time spent producing this result. */
    elapsedMs: number;
    /** Set when mock mode replaced a real failure, for logs and the UI. */
    fallbackReason?: string;
};

export class ArcadeError extends Error {
    readonly status?: number;
    readonly step: Stage | "config";
    readonly timeout: boolean;

    constructor(
        message: string,
        options: { step: Stage | "config"; status?: number; timeout?: boolean },
    ) {
        super(message);
        this.name = "ArcadeError";
        this.step = options.step;
        this.status = options.status;
        this.timeout = options.timeout ?? false;
    }
}

const MOCK_IMAGE_URL = "https://placehold.co/1200x1200/e7dfd2/3b342c/png?text=Memento+Pillow";
const MOCK_CHECKOUT_URL = "https://checkout.arcade.ai/demo";

type JobResponse = {
    jobId: string;
    kind?: string;
    status?: string;
    result?: Record<string, unknown> | null;
    error?: unknown;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POSTs to the Arcade API, capped by both the per-request timeout and the pipeline deadline.
 */
async function post<T extends Record<string, unknown>>(
    path: string,
    body: Record<string, unknown>,
    step: Stage | "config",
    deadline: number,
): Promise<T> {
    const { apiKey, baseUrl, userAgent, requestTimeoutMs } = arcadeConfig();

    if (!apiKey) {
        throw new ArcadeError("ARCADE_API_KEY is not set.", { step: "config" });
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        throw new ArcadeError(`Arcade ${step} step ran out of time (pipeline budget reached).`, {
            step,
            timeout: true,
        });
    }

    const timeoutMs = Math.min(requestTimeoutMs, remaining);
    const startedAt = Date.now();
    console.info("[arcade:timing] request started", {
        path,
        step,
        timeoutMs,
        pipelineRemainingMs: remaining,
    });

    let response: Response;
    try {
        response = await fetch(`${baseUrl}/v1${path}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "User-Agent": userAgent,
            },
            // Every request carries a fresh requestId so retries can never double-charge a job.
            body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
            signal: AbortSignal.timeout(timeoutMs),
            cache: "no-store",
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        throw new ArcadeError(
            timedOut ? `Arcade ${path} timed out after ${timeoutMs}ms.` : `Arcade ${path} failed: ${reason}`,
            { step, timeout: timedOut },
        );
    }

    const text = await response.text();
    console.info("[arcade:timing] request completed", {
        path,
        step,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        pipelineRemainingMs: deadline - Date.now(),
    });
    if (!response.ok) {
        throw new ArcadeError(`Arcade ${path} returned ${response.status}: ${text.slice(0, 300)}`, {
            step,
            status: response.status,
        });
    }

    try {
        return JSON.parse(text) as T;
    } catch {
        throw new ArcadeError(`Arcade ${path} returned non-JSON: ${text.slice(0, 300)}`, {
            step,
            status: response.status,
        });
    }
}

/**
 * Polls POST /v1/jobs/get until the job succeeds, fails, or the deadline passes.
 */
async function pollJob(
    jobId: string,
    step: Stage,
    deadline: number,
    onProgress?: ProgressCallback,
): Promise<Record<string, unknown>> {
    const { pollIntervalMs } = arcadeConfig();
    const startedAt = Date.now();
    let announcedProgress = false;
    let lastStatus: string | undefined;
    let lastDiagnosticAt = 0;

    for (; ;) {
        const job = await post<JobResponse>("/jobs/get", { jobId }, step, deadline);
        const now = Date.now();
        if (job.status !== lastStatus || now - lastDiagnosticAt >= 10_000) {
            console.info("[arcade:timing] job status", {
                jobId,
                step,
                status: job.status ?? "unknown",
                elapsedMs: now - startedAt,
                pipelineRemainingMs: deadline - now,
            });
            lastStatus = job.status;
            lastDiagnosticAt = now;
        }

        if (job.status === "succeeded") {
            if (!job.result) {
                throw new ArcadeError(`Job ${jobId} succeeded without a result.`, { step });
            }
            return job.result;
        }

        if (job.status === "failed" || job.error) {
            throw new ArcadeError(
                `Job ${jobId} failed: ${JSON.stringify(job.error ?? "unknown error").slice(0, 300)}`,
                { step },
            );
        }

        if (Date.now() >= deadline) {
            throw new ArcadeError(`Job ${jobId} was still running when the pipeline budget ran out.`, {
                step,
                timeout: true,
            });
        }

        // Arcade takes 10-30s per job, so reassure the UI that it is still moving.
        if (!announcedProgress && onProgress && Date.now() - startedAt > 5_000) {
            announcedProgress = true;
            const stageLabel = step === "pattern" ? "Illustration" : "Product build";
            onProgress({ stage: step, message: `${stageLabel} still rendering…` });
        }

        await sleep(pollIntervalMs);
    }
}

function mockResult(elapsedMs: number, fallbackReason?: string): ProductResult {
    const suffix = crypto.randomUUID().slice(0, 8);
    return {
        mock: true,
        patternId: `mock_pattern_${suffix}`,
        productId: `mock_product_${suffix}`,
        title: "Everyday Cotton Pillow Cover",
        selectionLabel: 'Everyday Cotton • 18" x 18"',
        previewImageUrl: MOCK_IMAGE_URL,
        images: [MOCK_IMAGE_URL],
        checkoutId: `mock_checkout_${suffix}`,
        checkoutUrl: MOCK_CHECKOUT_URL,
        elapsedMs,
        fallbackReason,
    };
}

async function runPipeline(
    imagePrompt: string,
    deadline: number,
    onProgress?: ProgressCallback,
): Promise<ProductResult> {
    const { categoryId, selections } = arcadeConfig();

    // 1. Pattern generation (the artwork itself).
    onProgress?.({ stage: "pattern", message: "Illustrating your memory…" });
    const patternJob = await post<JobResponse>("/patterns/create", { prompt: imagePrompt }, "pattern", deadline);
    const patternResult = await pollJob(patternJob.jobId, "pattern", deadline, onProgress);
    const patternId = patternResult.patternId as string | undefined;
    if (!patternId) {
        throw new ArcadeError(
            `Pattern job returned no patternId: ${JSON.stringify(patternResult).slice(0, 300)}`,
            { step: "pattern" },
        );
    }

    // 2. Product build from that pattern.
    onProgress?.({ stage: "product", message: "Building your pillow…" });
    const productJob = await post<JobResponse>(
        "/products/create",
        { patternId, categoryId, selections },
        "product",
        deadline,
    );
    const productResult = await pollJob(productJob.jobId, "product", deadline, onProgress);
    const productId = productResult.productId as string | undefined;
    if (!productId) {
        throw new ArcadeError(
            `Product job returned no productId: ${JSON.stringify(productResult).slice(0, 300)}`,
            { step: "product" },
        );
    }

    // 3. Read back the preview image for the UI.
    onProgress?.({ stage: "preview", message: "Fetching your preview…" });
    const product = await post<{
        title?: string;
        selectionLabel?: string;
        imageUrl?: string;
        images?: { url?: string }[];
    }>("/products/get", { productId }, "preview", deadline);

    const images = (product.images ?? [])
        .map((image) => image?.url)
        .filter((url): url is string => Boolean(url));

    // 4. Checkout link. supplyChain requires dropShip for a single-unit purchase.
    onProgress?.({ stage: "checkout", message: "Creating your checkout link…" });
    const checkout = await post<{ checkoutId?: string; checkoutUrl?: string }>(
        "/checkouts/create",
        { dropShip: true, lines: [{ productId, quantity: 1 }] },
        "checkout",
        deadline,
    );

    if (!checkout.checkoutUrl) {
        throw new ArcadeError(`Checkout returned no URL: ${JSON.stringify(checkout).slice(0, 300)}`, {
            step: "checkout",
        });
    }

    return {
        mock: false,
        patternId,
        productId,
        title: product.title,
        selectionLabel: product.selectionLabel,
        previewImageUrl: product.imageUrl ?? images[0],
        images,
        checkoutId: checkout.checkoutId,
        checkoutUrl: checkout.checkoutUrl,
        elapsedMs: 0,
    };
}

/**
 * Runs the full Arcade pipeline: pattern -> product -> preview -> checkout.
 *
 * ARCADE_MOCK=true      never hits the network.
 * ARCADE_MOCK=fallback  tries the real pipeline and falls back to a mock result if it fails
 *                       or exceeds ARCADE_TOTAL_BUDGET_MS, so a live demo never hangs.
 * ARCADE_MOCK=false     surfaces real errors (use this while integrating).
 */
export async function generateProduct(
    imagePrompt: string,
    options: PipelineOptions = {},
): Promise<ProductResult> {
    const { mock, pipelineBudgetMs } = arcadeConfig();
    const startedAt = Date.now();
    const onProgress = options.onProgress;

    if (mock === "true") {
        onProgress?.({ stage: "pattern", message: "Mock mode: skipping Arcade…" });
        return mockResult(Date.now() - startedAt, "ARCADE_MOCK=true");
    }

    // The caller owns the deadline so the LLM call and the Arcade pipeline share one budget.
    const deadline = options.deadline ?? startedAt + pipelineBudgetMs;

    try {
        const result = await runPipeline(imagePrompt, deadline, onProgress);
        return { ...result, elapsedMs: Date.now() - startedAt };
    } catch (error) {
        if (mock !== "fallback") throw error;
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[arcade] falling back to a mock product: ${reason}`);
        return mockResult(Date.now() - startedAt, reason);
    }
}
