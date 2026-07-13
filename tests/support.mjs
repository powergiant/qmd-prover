import { chmod, mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const here = path.dirname(new URL(import.meta.url).pathname);
export const fakePandoc = path.join(here, 'fixtures', 'fake-pandoc.mjs');
export const verifier = path.join(here, 'fixtures', 'mock-verifier.mjs');
export const staleVerifier = path.join(here, 'fixtures', 'stale-verifier.mjs');
export const malformedVerifier = path.join(here, 'fixtures', 'malformed-verifier.mjs');
export const options = { pandoc: fakePandoc };

process.env.PATH = `${path.dirname(process.execPath)}:${process.env.PATH}`;

export async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qmd-prover-'));
  await mkdir(path.join(root, '.qmd-prover', 'workspaces', 'test', 'proposals'), { recursive: true });
  await Promise.all([chmod(fakePandoc, 0o755), chmod(verifier, 0o755), chmod(staleVerifier, 0o755), chmod(malformedVerifier, 0o755)]);
  return root;
}

export function bareProject() {
  return mkdtemp(path.join(os.tmpdir(), 'qmd-prover-init-'));
}

export function proposalPath(root, name) {
  return path.join(root, '.qmd-prover', 'workspaces', 'test', 'proposals', name);
}

export function proof(id, text) {
  return `::: {.proof of="${id}"}\n${text}\n:::\n`;
}

export function result(id, statement, { proofText, title = id, exported = false, extra = '' } = {}) {
  const kind = id.startsWith('lem-') ? 'lemma' : id.startsWith('def-') ? 'definition' : id.startsWith('prp-') ? 'proposition' : id.startsWith('cor-') ? 'corollary' : 'theorem';
  const block = `::: {#${id} .${kind}${id.startsWith('thm-main-') ? ' .goal' : ''} name="${title}" date="2026-07-13"${exported ? ` export="${id}"` : ''}${extra}}\n${statement}\n:::\n`;
  return proofText == null ? block : `${block}\n${proof(id, proofText)}`;
}

export function document(imports, body) {
  if (!imports.length) return body;
  return `---\nqmd-prover:\n  imports:\n${imports.map((entry) => `    - from: ${entry.from}\n      use:\n${entry.use.map((id) => `        - ${id}`).join('\n')}`).join('\n')}\n---\n\n${body}`;
}
