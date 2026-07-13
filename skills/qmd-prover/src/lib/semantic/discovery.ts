import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AUX, relativePosix } from '../infrastructure/files.js';
import { hasErrorCode, uniqueSorted } from '../shared/core.js';
import type { QmdProverConfig } from '../shared/types.js';

interface Exclusion { pattern: string; negate: boolean }
export interface DiscoveredFile { absolute: string; relative: string }

function excluded(relative: string, exclusions: Exclusion[]): boolean {
  let ignored = false;
  for (const entry of exclusions) {
    const rooted = entry.pattern.startsWith('/');
    const pattern = entry.pattern.replace(/^\//, '').replace(/\/$/, '');
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll('**', '\0')
      .replaceAll('*', '[^/]*')
      .replaceAll('?', '[^/]')
      .replaceAll('\0', '.*');
    const prefix = rooted || pattern.includes('/') ? '^' : '(?:^|/)';
    if (new RegExp(`${prefix}${escaped}(?:/|$)`).test(relative)) ignored = !entry.negate;
  }
  return ignored;
}

function mayReincludeDescendant(relative: string, exclusions: Exclusion[]): boolean {
  return exclusions.some((entry) => {
    if (!entry.negate) return false;
    const pattern = entry.pattern.replace(/^\//, '').replace(/\/$/, '');
    if (!pattern.includes('/')) return true;
    const wildcard = [pattern.indexOf('*'), pattern.indexOf('?')].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? pattern.length;
    const prefix = pattern.slice(0, wildcard).replace(/\/$/, '');
    return prefix === relative || prefix.startsWith(`${relative}/`);
  });
}

export async function discoveryExclusions(root: string, config: QmdProverConfig): Promise<Exclusion[]> {
  let ignored: Exclusion[] = [];
  try {
    ignored = (await readFile(path.join(root, '.gitignore'), 'utf8')).split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => ({ pattern: line.replace(/^!/, ''), negate: line.startsWith('!') }))
      .filter((entry) => entry.pattern !== '');
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
  const protectedExclusions = uniqueSorted([
    AUX,
    '.git',
    'node_modules',
    ...(Array.isArray(config.project.exclude) ? config.project.exclude : []),
    config.render['output-dir']
  ].filter(Boolean).map((entry) => String(entry).replace(/^\.\//, '').replace(/\/$/, '')))
    .map((pattern) => ({ pattern, negate: false }));
  return [...ignored, ...protectedExclusions];
}

export async function discover(directory: string, root: string, exclusions: Exclusion[], output: DiscoveredFile[] = []): Promise<DiscoveredFile[]> {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = relativePosix(root, absolute);
    if (excluded(relative, exclusions) && !(entry.isDirectory() && mayReincludeDescendant(relative, exclusions))) continue;
    if (entry.isDirectory()) await discover(absolute, root, exclusions, output);
    else if (entry.isFile() && entry.name.endsWith('.qmd')) output.push({ absolute, relative: relativePosix(root, absolute) });
  }
  return output;
}
