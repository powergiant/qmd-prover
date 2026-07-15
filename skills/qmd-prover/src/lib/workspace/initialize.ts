import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from '../semantic/compiler.js';
import { atomicJson, atomicWrite, exists, readJson, relativePosix, withWriteLock } from '../infrastructure/files.js';
import { readLocatedBlock } from '../semantic/source.js';
import type { InitializeWorkspaceResult, RuntimeOptions } from '../shared/types.js';
import { workspaceDirectory } from './support.js';

export async function initializeWorkspace(root: string, requested: string, options: RuntimeOptions = {}): Promise<InitializeWorkspaceResult> {
  root = path.resolve(root);
  const { id, directory } = workspaceDirectory(root, requested);
  const workspace = relativePosix(root, directory);
  const compilation = await compileProject(root, { ...options, semanticMode: 'project-goals', write: false });
  if (!compilation.ok) return {
    schema_version: 4,
    operation: 'workspace-init',
    ok: false,
    status: 'blocked',
    workspace,
    diagnostics: compilation.diagnostics,
    remediation: 'Repair the reported project diagnostics, then rerun this exact workspace init command. No workspace files were changed.'
  };
  const target = compilation.manifest.results.find((result) => result.id === id);
  if (!target) return {
    schema_version: 4,
    operation: 'workspace-init',
    ok: false,
    status: 'blocked',
    workspace,
    diagnostics: [{ severity: 'error', code: 'FACT_UNKNOWN', id, message: `No protected main goal named @${id} exists.` }]
  };
  if (target.origin !== 'user') return {
    schema_version: 4,
    operation: 'workspace-init',
    ok: false,
    status: 'blocked',
    workspace,
    diagnostics: [{ severity: 'error', code: 'WORKSPACE_TARGET_INVALID', id, file: target.file, message: `@${id} is not a protected main goal.` }]
  };
  const metadataFile = path.join(directory, 'workspace.json');
  if (await exists(metadataFile)) {
    return { schema_version: 4, operation: 'workspace-init', ok: true, status: 'resumed', workspace, metadata: await readJson(metadataFile) };
  }
  const located = await readLocatedBlock(path.join(root, target.file), id);
  if (!located) return {
    schema_version: 4,
    operation: 'workspace-init',
    ok: false,
    status: 'blocked',
    workspace,
    diagnostics: [{ severity: 'error', code: 'MAIN_GOAL_SOURCE_NOT_FOUND', id, file: target.file, message: `The protected source block for @${id} could not be located.` }]
  };
  const metadata = {
    schema_version: 4,
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
  const adoptedExisting = await exists(directory);
  await withWriteLock(root, async () => {
    // Preserve the established project snapshot side effect, but only after the read-only preflight succeeds.
    await compileProject(root, { ...options, semanticMode: 'project-goals' });
    await Promise.all(['context', 'attempts', 'dead-ends', 'proposals', 'verification'].map((name) => mkdir(path.join(directory, name), { recursive: true })));
    const targetFile = path.join(directory, 'target.qmd');
    const progressFile = path.join(directory, 'progress.qmd');
    if (!await exists(targetFile)) await atomicWrite(targetFile, `${located.raw.trim()}\n`);
    if (!await exists(progressFile)) await atomicWrite(progressFile, `---\ntitle: "Workspace: ${target.title}"\n---\n\n## Current frontier\n\n- @${id}: ${target.status}\n\n## Active route\n\nRecord the current proof route here.\n\n## Abandoned routes\n\nKeep detailed dead ends under \`dead-ends/\`.\n`);
    // Metadata is the initialization commit point. Existing QMD is never overwritten.
    await atomicJson(metadataFile, metadata);
  });
  return {
    schema_version: 4,
    operation: 'workspace-init',
    ok: true,
    status: adoptedExisting ? 'adopted' : 'created',
    workspace,
    metadata,
    preserved_existing_qmd: adoptedExisting
  };
}
