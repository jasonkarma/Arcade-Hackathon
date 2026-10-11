import "server-only";

function read(name: string): string | undefined {
    const raw = process.env[name];
    if (raw === undefined) return undefined;
    // .env files often wrap values in quotes; strip them before use.
    const value = raw.trim().replace(/^["']([\s\S]*)["']$/, "$1").trim();
    return value === "" ? undefined : value;
}

function required(name: string): string {
    const value = read(name);
    if (!value) {
        throw new Error(
            `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
        );
    }
    return value;
}

function num(name: string, fallback: number): number {
    const raw = read(name);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** "true" = never call Arcade, "fallback" = call Arcade but show a mock if it fails or runs long, "false" = strict. */
export type MockMode = "true" | "fallback" | "false";

function mockMode(): MockMode {
    const raw = (read("ARCADE_MOCK") ?? "false").toLowerCase();
    return raw === "true" || raw === "fallback" ? raw : "false";
}

export type ArcadeConfig = {
    apiKey: string;
    baseUrl: string;
    userAgent: string;
    /** Per-HTTP-request timeout. */
    requestTimeoutMs: number;
    /** How often to poll /v1/jobs/get. */
    pollIntervalMs: number;
    /**
     * Total wall clock for one request, covering the LLM call and the whole Arcade
     * pipeline. Must stay under the route's maxDuration, or the platform kills the
     * response mid-stream.
     */
    pipelineBudgetMs: number;
    mock: MockMode;
    /** Decorative Pillows, from POST /v1/categories/list. */
    categoryId: string;
    /** Keys must match the option keys returned by POST /v1/categories/get. */
    selections: {
        fabric: string;
        size: string;
        embellishment: string;
        insert: string;
    };
};

export function arcadeConfig(): ArcadeConfig {
    return {
        // Read lazily and allow empty: mock mode must work with no key configured.
        apiKey: read("ARCADE_API_KEY") ?? "",
        baseUrl: (read("ARCADE_API_BASE_URL") ?? "https://platform.arcade.ai").replace(/\/+$/, ""),
        userAgent: read("ARCADE_USER_AGENT") ?? "memento/1.0",
        requestTimeoutMs: num("ARCADE_REQUEST_TIMEOUT_MS", 30_000),
        pollIntervalMs: num("ARCADE_POLL_INTERVAL_MS", 2_500),
        pipelineBudgetMs: num("PIPELINE_BUDGET_MS", 270_000),
        mock: mockMode(),
        categoryId: read("ARCADE_PILLOW_CATEGORY_ID") ?? "0ef267de-f8c2-4a93-89a3-63be809f68e2",
        selections: {
            fabric: read("ARCADE_PILLOW_FABRIC") ?? "canvas",
            size: read("ARCADE_PILLOW_SIZE") ?? "18x18",
            embellishment: read("ARCADE_PILLOW_EMBELLISHMENT") ?? "none",
            insert: read("ARCADE_PILLOW_INSERT") ?? "none",
        },
    };
}

export type LlmConfig = {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
};

export function llmConfig(): LlmConfig {
    return {
        apiKey: required("OPENAI_API_KEY"),
        baseUrl: (read("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
        model: read("OPENAI_MODEL") ?? "gpt-4o-mini",
        timeoutMs: num("LLM_TIMEOUT_MS", 30_000),
    };
}
