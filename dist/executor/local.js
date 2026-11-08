import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
/** Ollama on the home server. Override with OLLAMA_URL when the bridge runs elsewhere. */
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.LOCAL_LLM_MODEL || 'gemma4-e2b';
const RECALL_DIR = process.env.RECALL_DIR || path.join(os.homedir(), 'ai', 'recall');
/** Search the recall notes index (memory, project docs, session digests) and return the top passages. */
async function searchNotes(query, k = 6) {
    const { stdout } = await execFileAsync('uv', ['run', '-q', '--project', RECALL_DIR, 'python', path.join(RECALL_DIR, 'cli.py'), 'search', query, '-k', String(k)], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PATH: `${os.homedir()}/.local/bin:/home/linuxbrew/.linuxbrew/bin:${process.env.PATH ?? ''}` } });
    const paths = [...stdout.matchAll(/^\d\.\d{3}\s+(\S+)/gm)].map((m) => m[1]);
    return { text: stdout.trim(), paths };
}
async function imageToBase64(p) {
    const full = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
    return (await fs.readFile(full)).toString('base64');
}
/** One chat turn with the free local model. Slow (CPU only): expect 10 to 60 seconds for short answers. */
export async function runLocalChat(opts) {
    const model = opts.model || DEFAULT_MODEL;
    const started = Date.now();
    try {
        let notes;
        if (opts.useNotes)
            notes = await searchNotes(opts.prompt);
        const system = [
            opts.systemPrompt ||
                "You are Joseph's private assistant running on his home server. Be concise and practical.",
            notes ? `Relevant notes from Joseph's memory and project docs (cite paths when you use them):\n${notes.text}` : '',
        ]
            .filter(Boolean)
            .join('\n\n');
        const user = opts.context ? `${opts.prompt}\n\nContext:\n${opts.context}` : opts.prompt;
        const images = opts.images?.length ? await Promise.all(opts.images.map(imageToBase64)) : undefined;
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model,
                stream: false,
                think: opts.think ?? false,
                keep_alive: '30m',
                options: { num_predict: opts.maxTokens ?? 1024, num_ctx: 16384 },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user, ...(images ? { images } : {}) },
                ],
            }),
            signal: AbortSignal.timeout(15 * 60_000),
        });
        if (!res.ok)
            throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data = await res.json();
        const evalSec = (data.eval_duration ?? 0) / 1e9;
        return {
            success: true,
            response: (data.message?.content ?? '').trim(),
            model,
            durationSeconds: Math.round((Date.now() - started) / 100) / 10,
            tokens: {
                prompt: data.prompt_eval_count,
                output: data.eval_count,
                outputPerSecond: evalSec ? Math.round((data.eval_count / evalSec) * 10) / 10 : undefined,
            },
            notesUsed: notes?.paths,
        };
    }
    catch (e) {
        return {
            success: false,
            response: '',
            model,
            durationSeconds: Math.round((Date.now() - started) / 100) / 10,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}
/** Models installed in the home server's Ollama. */
export async function listLocalModels() {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(15_000) });
    const data = await res.json();
    return (data.models ?? []).map((m) => ({
        name: m.name,
        sizeGB: Math.round((m.size / 1e9) * 10) / 10,
        capabilities: m.capabilities,
    }));
}
