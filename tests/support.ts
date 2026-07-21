import { chmod, mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const here = path.dirname(new URL(import.meta.url).pathname);
export const fakePandoc = path.join(here, '.generated-fixtures', 'fake-pandoc.js');
export const verifier = path.join(here, '.generated-fixtures', 'mock-verifier.js');
export const staleVerifier = path.join(here, '.generated-fixtures', 'stale-verifier.js');
export const malformedVerifier = path.join(here, '.generated-fixtures', 'malformed-verifier.js');
export const options = { pandoc: fakePandoc };

export function must<T>(value: T | null | undefined, message = 'Expected value to be present'): T {
  if (value == null) throw new Error(message);
  return value;
}

process.env.PATH = `${path.dirname(process.execPath)}:${process.env.PATH}`;

export async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qmd-prover-'));
  await mkdir(path.join(root, '.qmd-prover'), { recursive: true });
  await Promise.all([chmod(fakePandoc, 0o755), chmod(verifier, 0o755), chmod(staleVerifier, 0o755), chmod(malformedVerifier, 0o755)]);
  return root;
}

export function bareProject() {
  return mkdtemp(path.join(os.tmpdir(), 'qmd-prover-init-'));
}

export function proof(
  id: string,
  text: string,
  { disproof = false, draft = false, assumed = false, abandon = false }: { disproof?: boolean; draft?: boolean; assumed?: boolean; abandon?: boolean } = {}
): string {
  const classes = `.proof${disproof ? ' .disproof' : ''}${draft ? ' .draft' : ''}${assumed ? ' .assumed' : ''}${abandon ? ' .abandon' : ''}`;
  return `::: {${classes} of="${id}"}\n${text}\n:::\n`;
}

export function result(
  id: string,
  statement: string,
  { proofText, title = id, exported = false, extra = '', disproof = false, draft = false, assumed = false, abandon = false }: {
    proofText?: string;
    title?: string;
    exported?: boolean;
    extra?: string;
    disproof?: boolean;
    draft?: boolean;
    assumed?: boolean;
    abandon?: boolean;
  } = {}
): string {
  const kind = id.startsWith('lem-') ? 'lemma' : id.startsWith('def-') ? 'definition' : id.startsWith('prp-') ? 'proposition' : id.startsWith('cor-') ? 'corollary' : 'theorem';
  // A result with no proof text may still carry `.assumed` on its own div (the assumed-statement / axiom case).
  const bodyAssumed = proofText == null && assumed ? ' .assumed' : '';
  const block = `::: {#${id} .${kind}${id.startsWith('thm-main-') ? ' .goal' : ''}${bodyAssumed} name="${title}" date="2026-07-13"${exported ? ` export="${id}"` : ''}${extra}}\n${statement}\n:::\n`;
  return proofText == null ? block : `${block}\n${proof(id, proofText, { disproof, draft, assumed, abandon })}`;
}

export function document(imports: Array<{ from: string; use: string[] }>, body: string): string {
  if (!imports.length) return body;
  return `---\nqmd-prover:\n  imports:\n${imports.map((entry) => `    - from: ${entry.from}\n      use:\n${entry.use.map((id) => `        - ${id}`).join('\n')}`).join('\n')}\n---\n\n${body}`;
}
