import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
const MAX_BYTES = 20 * 1024 * 1024;
export function feedDir() {
    return process.env.AGY_MCP_FEED_DIR || path.join(os.homedir(), '.agy-mcp');
}
export function feedPath() {
    return path.join(feedDir(), 'live.jsonl');
}
let dirReady = false;
function append(event) {
    try {
        const file = feedPath();
        if (!dirReady) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            dirReady = true;
        }
        try {
            if (fs.statSync(file).size > MAX_BYTES) {
                fs.renameSync(file, `${file}.1`);
            }
        }
        catch {
            // File does not exist yet
        }
        fs.appendFileSync(file, JSON.stringify(event) + '\n');
    }
    catch {
        // The feed is best-effort; never let it break a task
    }
}
export function createFeed(agent, taskId) {
    const task = taskId || randomUUID();
    let pending = '';
    let timer;
    const write = (kind, data) => append({ ts: Date.now(), task, agent, kind, ...data });
    const flush = () => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (pending) {
            write('text', { text: pending });
            pending = '';
        }
    };
    return {
        task,
        emit(kind, data = {}) {
            flush();
            write(kind, data);
        },
        text(delta) {
            pending += delta;
            const cut = pending.lastIndexOf('\n');
            if (cut >= 0) {
                const ready = pending.slice(0, cut + 1);
                pending = pending.slice(cut + 1);
                write('text', { text: ready });
            }
            if (pending && !timer) {
                timer = setTimeout(flush, 600);
                timer.unref?.();
            }
        },
    };
}
