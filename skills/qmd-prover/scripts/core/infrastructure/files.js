import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { asRecord, AUX, hasErrorCode } from '../shared/core.js';
export { AUX } from '../shared/core.js';
export function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
export function stable(value) {
    if (Array.isArray(value))
        return value.map(stable);
    if (value && typeof value === 'object') {
        const record = asRecord(value);
        return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stable(record[key])]));
    }
    return value;
}
export function stableJson(value, space = 2) {
    return `${JSON.stringify(stable(value), null, space)}\n`;
}
export async function exists(file) {
    try {
        await stat(file);
        return true;
    }
    catch (error) {
        if (hasErrorCode(error, 'ENOENT'))
            return false;
        throw error;
    }
}
export async function readJson(file, fallback) {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    }
    catch (error) {
        if (hasErrorCode(error, 'ENOENT') && fallback !== undefined)
            return fallback;
        throw error;
    }
}
export async function atomicWrite(file, data) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, file);
}
export async function atomicJson(file, value) {
    await atomicWrite(file, stableJson(value));
}
/**
 * Write `.qmd-prover/.gitignore` once, the first time any tool state lands there.
 * It version-controls the authored inputs (config, external basis, statement-lock
 * baseline) and ignores everything qmd-prover regenerates. Never overwritten, so a
 * project may customize it (e.g. share the verifier cache).
 */
export async function scaffoldAuxGitignore(root) {
    const file = path.join(root, AUX, '.gitignore');
    if (await exists(file))
        return;
    await atomicWrite(file, [
        '# qmd-prover writes derived tool state here. Track only the authored inputs.',
        '/*',
        '!/.gitignore',
        '!/config.yml',
        '!/.external.qmd',
        '!/statement-locks.json',
        ''
    ].join('\n'));
}
export async function appendEvent(root, event) {
    const file = path.join(root, AUX, 'events.jsonl');
    await mkdir(path.dirname(file), { recursive: true });
    const handle = await open(file, 'a');
    try {
        await handle.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
    }
    finally {
        await handle.close();
    }
}
export async function withWriteLock(root, operation, { timeoutMs = 5000 } = {}) {
    const lock = path.join(root, AUX, 'cache', 'write.lock');
    await mkdir(path.dirname(lock), { recursive: true });
    const started = Date.now();
    while (true) {
        try {
            await mkdir(lock);
            await atomicJson(path.join(lock, 'owner.json'), { pid: process.pid, acquired_at: new Date().toISOString() });
            break;
        }
        catch (error) {
            if (!hasErrorCode(error, 'EEXIST'))
                throw error;
            if (Date.now() - started >= timeoutMs)
                throw new Error(`Timed out waiting for canonical write lock: ${lock}`);
            await new Promise((resolve) => setTimeout(resolve, 40));
        }
    }
    try {
        return await operation();
    }
    finally {
        await rm(lock, { recursive: true, force: true });
    }
}
export function relativePosix(root, file) {
    return path.relative(root, file).split(path.sep).join('/');
}
export function cleanId(value) {
    return value.startsWith('@') ? value.slice(1) : value;
}
export function newId(prefix) {
    return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
}
