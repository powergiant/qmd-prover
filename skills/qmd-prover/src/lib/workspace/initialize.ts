import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from '../semantic/compiler.js';
import { atomicJson, atomicWrite, exists, readJson, relativePosix } from '../infrastructure/files.js';
import { readLocatedBlock } from '../semantic/source.js';
import type { InitializeWorkspaceResult, RuntimeOptions } from '../shared/types.js';
import { workspaceDirectory } from './support.js';

export async function initializeWorkspace(root: string, requested: string, options: RuntimeOptions = {}): Promise<InitializeWorkspaceResult> {
  root = path.resolve(root);
  const { id, directory } = workspaceDirectory(root, requested);
  const compilation = await compileProject(root, { ...options, semanticMode: 'project-goals' });
  if (!compilation.ok) throw new Error('Project has structural errors; repair them before creating a goal workspace');
  const target = compilation.manifest.results.find((result) => result.id === id);
  if (!target) throw new Error(`Unknown theorem: @${id}`);
  if (target.origin !== 'user') throw new Error(`@${id} is not a protected main goal`);
  const metadataFile = path.join(directory, 'workspace.json');
  if (await exists(metadataFile)) {
    return { schema_version: 1, status: 'resumed', workspace: relativePosix(root, directory), metadata: await readJson(metadataFile) };
  }
  const located = await readLocatedBlock(path.join(root, target.file), id);
  if (!located) throw new Error(`Protected main-goal source block for @${id} was not found`);
  await Promise.all(['context', 'attempts', 'dead-ends', 'proposals', 'verification'].map((name) => mkdir(path.join(directory, name), { recursive: true })));
  const metadata = {
    schema_version: 1,
    target: id,
    status: 'active',
    created_at: new Date().toISOString(),
    canonical: {
      file: target.file,
      statement_hash: target.statement_hash,
      title_hash: target.title_hash,
      proof_hash: target.proof_hash,
      status: target.status,
      dependencies: {}
    }
  };
  await Promise.all([
    atomicJson(metadataFile, metadata),
    atomicWrite(path.join(directory, 'target.qmd'), `${located.raw.trim()}\n`),
    atomicWrite(path.join(directory, 'progress.qmd'), `---\ntitle: "Workspace: ${target.title}"\n---\n\n## Current frontier\n\n- @${id}: ${target.status}\n\n## Active route\n\nRecord the current proof route here.\n\n## Abandoned routes\n\nKeep detailed dead ends under \`dead-ends/\`.\n`)
  ]);
  return { schema_version: 1, status: 'created', workspace: relativePosix(root, directory), metadata };
}
