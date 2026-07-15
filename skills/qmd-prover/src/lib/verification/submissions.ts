import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { AUX, cleanId, readJson } from '../infrastructure/files.js';
import { hasErrorCode } from '../shared/core.js';
import type { Diagnostic, JsonObject, OperationResult, RuntimeOptions, SubmissionResult } from '../shared/types.js';

export async function submitProof(root: string, proposalFile: string, options: RuntimeOptions = {}): Promise<SubmissionResult> {
  void root; void proposalFile; void options;
  return {
    schema_version: 4,
    operation: 'submit-proof',
    ok: false,
    status: 'retired',
    target: 'workspace',
    remediation: 'Keep definitions, results, and linked proofs in the protected goal workspace, then run inspect fact, inspect path, or inspect workspace. User QMD is never a promotion destination.'
  };
}

async function verificationRecords(root: string): Promise<Array<{ file: string; record: JsonObject }>> {
  const directory = path.join(path.resolve(root), AUX, 'verification');
  const records: Array<{ file: string; record: JsonObject }> = [];
  for (const selected of [directory, path.join(directory, 'checks')]) {
    let entries: string[] = [];
    try { entries = await readdir(selected); } catch (error) { if (!hasErrorCode(error, 'ENOENT')) throw error; }
    for (const name of entries.filter((entry) => entry.endsWith('.json') && entry !== 'index.json').sort()) {
      const file = path.join(selected, name);
      const record = await readJson<JsonObject>(file);
      if (typeof record.submission_id === 'string' || typeof record.target === 'string') {
        records.push({ file: path.relative(path.resolve(root), file).split(path.sep).join('/'), record });
      }
    }
  }
  return records;
}

export async function listVerifications(root: string): Promise<OperationResult> {
  const diagnostics: Diagnostic[] = [];
  let records: Array<{ file: string; record: JsonObject }> = [];
  try { records = await verificationRecords(root); }
  catch (error) {
    diagnostics.push({ severity: 'error', code: 'VERIFICATION_RECORD_INVALID', message: String((error as Error).message ?? error) });
  }
  const submissions = records.map(({ file, record }) => ({
    submission_id: String(record.submission_id ?? path.basename(file, '.json')),
    target: typeof record.target === 'string' ? record.target : null,
    outcome: typeof record.outcome === 'string' ? record.outcome : typeof record.verdict === 'string' ? record.verdict : null,
    verified_at: typeof record.verified_at === 'string' ? record.verified_at : null,
    file
  })).sort((left, right) => left.submission_id.localeCompare(right.submission_id));
  return { schema_version: 4, operation: 'verification-list', ok: diagnostics.length === 0, submissions, diagnostics };
}

export async function showVerification(root: string, submissionId: string): Promise<OperationResult> {
  const records = await verificationRecords(root);
  const found = records.find(({ file, record }) => record.submission_id === submissionId || path.basename(file, '.json') === submissionId);
  if (found) return {
    schema_version: 4,
    operation: 'verification-show',
    ok: true,
    submission_id: submissionId,
    file: found.file,
    record: found.record
  };
  return {
    schema_version: 4,
    operation: 'verification-show',
    ok: false,
    submission_id: submissionId,
    diagnostics: [{
      severity: 'error', code: 'SUBMISSION_NOT_FOUND',
      message: `No retained verification record has submission ID ${submissionId}.`,
      remediation: 'Run qmd-prover verification list to discover available submission IDs.'
    }]
  };
}

export async function revokeVerification(root: string, requested: string, reason: string, options: RuntimeOptions = {}): Promise<SubmissionResult> {
  void root; void reason; void options;
  return {
    schema_version: 4,
    operation: 'verification-revoke',
    ok: false,
    status: 'retired',
    target: cleanId(requested),
    remediation: 'Canonical marker mutation is retired. Change the workspace source or external basis and rerun inspection; legacy user-QMD markers remain untouched.'
  };
}
