import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
function getStoragePath() {
    const homeDir = os.homedir();
    return path.join(homeDir, '.gemini', 'antigravity-cli', 'agy_mcp_savings.json');
}
async function loadStorage() {
    const filePath = getStoragePath();
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    }
    catch {
        return {
            lifetimeTokensProcessed: 0,
            lifetimeClaudeContextSaved: 0,
            totalTasksDelegated: 0,
            history: [],
        };
    }
}
async function saveStorage(storage) {
    const filePath = getStoragePath();
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(storage, null, 2), 'utf8');
    }
    catch {
        // Non-blocking fallback
    }
}
export async function calculateAndRecordSavings(agyTotalTokens, instructionLength, responseLength, conversationId) {
    // Approximate 1 token = ~4 characters
    const claudeTokens = Math.max(1, Math.round((instructionLength + responseLength) / 4));
    const agyTokens = Math.max(0, agyTotalTokens);
    const savedTokens = Math.max(0, agyTokens - claudeTokens);
    const savingsPct = agyTokens > 0
        ? `${Math.max(0, ((savedTokens / agyTokens) * 100)).toFixed(1)}%`
        : '0.0%';
    const storage = await loadStorage();
    storage.lifetimeTokensProcessed += agyTokens;
    storage.lifetimeClaudeContextSaved += savedTokens;
    storage.totalTasksDelegated += 1;
    storage.history.push({
        timestamp: new Date().toISOString(),
        conversationId,
        agyTokens,
        claudeTokens,
        savedTokens,
    });
    // Keep last 100 entries in history
    if (storage.history.length > 100) {
        storage.history = storage.history.slice(-100);
    }
    await saveStorage(storage);
    return {
        tokensProcessedByAntigravity: agyTokens,
        tokensIngestedByClaude: claudeTokens,
        tokensSavedInClaudeContext: savedTokens,
        savingsPercentage: savingsPct,
        lifetimeTokensProcessed: storage.lifetimeTokensProcessed,
        lifetimeClaudeContextSaved: storage.lifetimeClaudeContextSaved,
        totalTasksDelegated: storage.totalTasksDelegated,
    };
}
export async function getSavingsSummary() {
    const storage = await loadStorage();
    const overallPct = storage.lifetimeTokensProcessed > 0
        ? `${((storage.lifetimeClaudeContextSaved / storage.lifetimeTokensProcessed) *
            100).toFixed(1)}%`
        : '0.0%';
    return {
        totalTasksDelegated: storage.totalTasksDelegated,
        lifetimeTokensProcessed: storage.lifetimeTokensProcessed,
        lifetimeClaudeContextSaved: storage.lifetimeClaudeContextSaved,
        overallSavingsPercentage: overallPct,
        recentTasks: storage.history.slice(-10),
    };
}
