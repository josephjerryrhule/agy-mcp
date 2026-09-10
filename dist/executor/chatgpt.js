import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[38;2;80;235;150m';
const BLUE = '\x1b[38;2;90;170;255m';
export async function resolveOpenAiApiKey() {
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
        return process.env.OPENAI_API_KEY.trim();
    }
    // Check ~/.codex/auth.json
    try {
        const authPath = path.join(os.homedir(), '.codex', 'auth.json');
        const raw = await fs.readFile(authPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.OPENAI_API_KEY === 'string' && parsed.OPENAI_API_KEY.trim()) {
            return parsed.OPENAI_API_KEY.trim();
        }
    }
    catch {
        // Ignore error reading file
    }
    return null;
}
export async function runChatgptConsult(options) {
    const apiKey = await resolveOpenAiApiKey();
    if (!apiKey) {
        return {
            success: false,
            response: '',
            model: options.model || 'o3-mini',
            error: 'OpenAI API Key not found. Please set OPENAI_API_KEY in your environment or in Claude Desktop / Claude Code mcpServers env configuration.',
        };
    }
    const model = options.model || 'o3-mini';
    const isReasoningModel = model.startsWith('o1') || model.startsWith('o3') || model.includes('reasoning');
    const messages = [];
    const systemContent = options.systemPrompt ||
        'You are an expert technical advisor and architecture consultant. Provide rigorous, actionable, and precise analysis.';
    // o-series models often prefer developer/user messages over system messages
    if (!isReasoningModel) {
        messages.push({ role: 'system', content: systemContent });
    }
    let userPrompt = options.prompt;
    if (options.context) {
        userPrompt = `[CONTEXT / REFERENCE]\n${options.context}\n\n[QUERY / INSTRUCTION]\n${options.prompt}`;
    }
    if (isReasoningModel) {
        userPrompt = `[DIRECTIVE]\n${systemContent}\n\n${userPrompt}`;
    }
    messages.push({ role: 'user', content: userPrompt });
    const requestBody = {
        model,
        messages,
    };
    if (isReasoningModel && options.reasoningEffort) {
        requestBody.reasoning_effort = options.reasoningEffort;
    }
    else if (!isReasoningModel && typeof options.temperature === 'number') {
        requestBody.temperature = options.temperature;
    }
    const startTime = Date.now();
    process.stderr.write(`\n${BLUE}${BOLD}💬 [ChatGPT Consulting Initialized]${RESET} ${DIM}model: ${model}${RESET}\n`);
    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });
        const durationSeconds = Math.round((Date.now() - startTime) / 100) / 10;
        if (!res.ok) {
            const errText = await res.text();
            let errMsg = `OpenAI API returned status ${res.status}`;
            try {
                const errJson = JSON.parse(errText);
                if (errJson.error?.message) {
                    errMsg = errJson.error.message;
                }
            }
            catch {
                errMsg += `: ${errText.slice(0, 300)}`;
            }
            return {
                success: false,
                response: '',
                model,
                durationSeconds,
                error: errMsg,
            };
        }
        const json = (await res.json());
        const choice = json.choices?.[0];
        const content = choice?.message?.content || '(No response content)';
        const rawUsage = json.usage;
        const usage = rawUsage
            ? {
                prompt_tokens: rawUsage.prompt_tokens,
                completion_tokens: rawUsage.completion_tokens,
                reasoning_tokens: rawUsage.completion_tokens_details?.reasoning_tokens,
                total_tokens: rawUsage.total_tokens,
            }
            : {};
        process.stderr.write(`\n${GREEN}${BOLD}✨ [ChatGPT Response Received]${RESET} ${DIM}Duration: ${durationSeconds}s, Tokens: ${usage.total_tokens || 0}${RESET}\n`);
        return {
            success: true,
            response: content,
            model,
            durationSeconds,
            usage,
        };
    }
    catch (err) {
        const durationSeconds = Math.round((Date.now() - startTime) / 100) / 10;
        return {
            success: false,
            response: '',
            model,
            durationSeconds,
            error: `Failed to connect to OpenAI API: ${err.message}`,
        };
    }
}
export async function runChatgptReview(options) {
    const focus = options.focus || 'thorough';
    const focusPrompts = {
        security: 'Focus strictly on security vulnerabilities, permission hazards, input sanitation, and auth leaks.',
        performance: 'Focus on algorithmic performance, asymptotic complexity, unnecessary disk/network I/O, and memory leaks.',
        architecture: 'Focus on separation of concerns, modularity, idiomatic design patterns, and maintainability.',
        thorough: 'Provide a thorough multi-dimensional review covering correctness, edge cases, security, and clean code principles.',
    };
    const systemPrompt = `You are a principal engineer conducting an adversarial code review.
${focusPrompts[focus] || focusPrompts.thorough}
- Point out concrete issues with line references or code snippets where applicable.
- Categorize findings into: CRITICAL, WARNING, SUGGESTION.
- If the code is solid, state what is well implemented.`;
    const prompt = options.instructions
        ? `${options.instructions}\n\nReview the following code or git diff:`
        : 'Review the following code or git diff against best practices:';
    return runChatgptConsult({
        prompt,
        context: options.diffOrCode,
        systemPrompt,
        model: options.model || 'o3-mini',
    });
}
