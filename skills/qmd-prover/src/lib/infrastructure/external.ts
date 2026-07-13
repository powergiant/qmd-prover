import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AUX, exists, relativePosix, sha256 } from './files.js';
import type { ExternalPolicy, JsonObject } from '../shared/types.js';

export function externalPolicyHash(policy: JsonObject): string {
  return sha256(JSON.stringify(policy));
}

export async function readExternalPolicy(root: string): Promise<ExternalPolicy> {
  const file = path.join(root, AUX, '.external.qmd');
  if (!await exists(file)) return { path: relativePosix(root, file), mode: 'unrestricted', content: null };
  const content = await readFile(file, 'utf8');
  return { path: relativePosix(root, file), mode: content.trim() ? 'declared' : 'none', content };
}
