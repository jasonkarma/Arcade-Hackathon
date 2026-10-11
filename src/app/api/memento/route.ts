import { NextResponse } from "next/server";
import { ArcadeError, generateProduct, type ProgressEvent } from "@/lib/arcade";
import { arcadeConfig } from "@/lib/env";
import { LlmError, generateImagePrompt } from "@/lib/llm";

/**
 * PIPELINE_BUDGET_MS must stay below this or the platform kills the response
 * mid-stream. Ignored when serving locally, where the budget is the only limit.
 */
export const maxDuration = 120;

const MIN_MEMORY_LENGTH = 10;
const MAX_MEMORY_LENGTH = 1000;

type StreamEvent =
    | ({ type: "progress" } & ProgressEvent)
    | { type: "done"; imagePrompt: string; product: Awaited<ReturnType<typeof generateProduct>> }
    | { type: "error"; message: string };

function errorResponse(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

function clientMessage(error: unknown): string {
    if (error instanceof LlmError) {
        return "We couldn't describe your memory just now. Please try again.";
    }
    if (error instanceof ArcadeError) {
        return error.timeout
            ? "The maker is taking longer than expected. Please try again."
            : "The maker couldn't build that piece just now. Please try again.";
    }
    return "Something went wrong on our side. Please try again.";
}

export async function POST(request: Request) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return errorResponse("Send a JSON body of the form { memory: string }.", 400);
    }

    const memory = (body as { memory?: unknown } | null)?.memory;
    if (typeof memory !== "string") {
        return errorResponse("The memory field must be a string.", 400);
    }

    const trimmed = memory.trim();
    if (trimmed.length < MIN_MEMORY_LENGTH || trimmed.length > MAX_MEMORY_LENGTH) {
        return errorResponse(
            `Please describe the memory in ${MIN_MEMORY_LENGTH} to ${MAX_MEMORY_LENGTH} characters.`,
            400,
        );
    }

    // One deadline covers the LLM call and the whole Arcade pipeline, under maxDuration.
    const deadline = Date.now() + arcadeConfig().pipelineBudgetMs;

    // Stream progress so a 30-60s pipeline shows staged status instead of a dead spinner.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: StreamEvent) => {
                controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            };

            try {
                send({ type: "progress", stage: "pattern", message: "Reading your memory…" });
                const imagePrompt = await generateImagePrompt(trimmed, {
                    timeoutMs: deadline - Date.now(),
                });

                send({ type: "progress", stage: "pattern", message: "Illustrating your memory…" });
                const product = await generateProduct(imagePrompt, {
                    deadline,
                    onProgress: (event) => send({ type: "progress", ...event }),
                });

                send({ type: "done", imagePrompt, product });
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                console.error("[memento] pipeline failed:", detail);
                send({ type: "error", message: clientMessage(error) });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
        },
    });
}

export function GET() {
    return errorResponse("Use POST with a JSON body of the form { memory: string }.", 405);
}
