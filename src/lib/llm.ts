import "server-only";
import { llmConfig } from "./env";

export class LlmError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LlmError";
    }
}

/**
 * The pattern generator prints a single square overlay onto fabric, so the prompt
 * has to describe one centred illustration with margin to spare at the edges.
 */
const SYSTEM_PROMPT = `You turn a personal memory into an image-generation prompt for artwork printed on a decorative pillow.

Rules:
- Output ONLY the prompt. No preamble, no quotes, no headings, no explanation.
- One sentence, 40 words or fewer.
- Describe a single clear focal subject with a warm, nostalgic, hand-made illustrative feel.
- Name a concrete art style and a short colour palette drawn from the memory.
- Use a centred, balanced composition with generous margins: the weave wraps the edges, so nothing important may sit near the border.
- Never include text, letters, numbers, captions, logos or watermarks in the image.
- Never invent people, places, dates or events that are not in the memory.`

type ChatCompletion = {
    choices?: { message?: { content?: string | null } }[];
};

/**
 * Calls an OpenAI-compatible chat completions endpoint and returns a trimmed image prompt.
 * Pass `timeoutMs` to shrink the call to whatever budget the caller has left.
 */
export async function generateImagePrompt(
    memory: string,
    options: { timeoutMs?: number } = {},
): Promise<string> {
    const config = llmConfig();
    const { apiKey, baseUrl, model } = config;
    const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? config.timeoutMs, config.timeoutMs));

    let response: Response;
    try {
        response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                temperature: 0.8,
                max_tokens: 160,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: `Memory:\n"""${memory}"""` },
                ],
            }),
            signal: AbortSignal.timeout(timeoutMs),
            cache: "no-store",
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new LlmError(`LLM request failed: ${reason}`);
    }

    const text = await response.text();
    if (!response.ok) {
        throw new LlmError(`LLM ${response.status}: ${text.slice(0, 300)}`);
    }

    let payload: ChatCompletion;
    try {
        payload = JSON.parse(text) as ChatCompletion;
    } catch {
        throw new LlmError(`LLM returned non-JSON: ${text.slice(0, 300)}`);
    }

    const prompt = payload.choices?.[0]?.message?.content?.trim();
    if (!prompt) {
        throw new LlmError(`LLM returned an empty prompt: ${text.slice(0, 300)}`);
    }

    return prompt;
}
