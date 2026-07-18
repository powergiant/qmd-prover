import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { asRecord, AUX, hasErrorCode } from '../shared/core.js';
import type { JsonObject } from '../shared/types.js';

export { AUX } from '../shared/core.js';

export function sha256(value: string | NodeJS.ArrayBufferView): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const record = asRecord(value);
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stable(record[key])]));
  }
  return value;
}

export function stableJson(value: unknown, space = 2): string {
  return `${JSON.stringify(stable(value), null, space)}\n`;
}

export async function exists(file: string | URL): Promise<boolean> {
  try { await stat(file); return true; } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}

export async function readJson<T = unknown>(file: string | URL, fallback?: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch (error) {
    if (hasErrorCode(error, 'ENOENT') && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function atomicWrite(file: string, data: string | NodeJS.ArrayBufferView): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await atomicWrite(file, stableJson(value));
}

/**
 * Write `.qmd-prover/.gitignore` once, the first time any tool state lands there.
 * It version-controls the authored inputs (config, external basis, statement-lock
 * baseline) and ignores everything qmd-prover regenerates. Never overwritten, so a
 * project may customize it (e.g. share the verifier cache).
 */
export async function scaffoldAuxGitignore(root: string): Promise<void> {
  const file = path.join(root, AUX, '.gitignore');
  if (await exists(file)) return;
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

export async function appendEvent(root: string, event: JsonObject): Promise<void> {
  const file = path.join(root, AUX, 'events.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, 'a');
  try {
    await handle.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  } finally {
    await handle.close();
  }
}

export async function withWriteLock<T>(root: string, operation: () => Promise<T>, { timeoutMs = 5000 }: { timeoutMs?: number } = {}): Promise<T> {
  const lock = path.join(root, AUX, 'cache', 'write.lock');
  await mkdir(path.dirname(lock), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lock);
      await atomicJson(path.join(lock, 'owner.json'), { pid: process.pid, acquired_at: new Date().toISOString() });
      break;
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error;
      if (Date.now() - started >= timeoutMs) throw new Error(`Timed out waiting for canonical write lock: ${lock}`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  try { return await operation(); } finally { await rm(lock, { recursive: true, force: true }); }
}

export function relativePosix(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

export function cleanId(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value;
}

export function newId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
}
