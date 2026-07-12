import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { appendEvent, atomicJson, atomicWrite, AUX, newId, readJson, sha256, withWriteLock } from './files.mjs';
import { compileProject } from './compiler.mjs';
import { readLocatedBlock, readLocatedProof, mergeProof } from './source.mjs';

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, QMD_PROVER_FRESH_CONTEXT: '1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function verifierCommand(config) {
  const override = process.env.QMD_PROVER_VERIFIER;
  if (override) return { command: override, args: [] };
  const configured = config.verification.command;
  if (Array.isArray(configured) && configured.length) return { command: configured[0], args: configured.slice(1) };
  if (typeof configured === 'string' && configured.trim()) return { command: configured.trim(), args: [] };
  return null;
}

async function invokeVerifier(packet, config) {
  const executable = verifierCommand(config);
  if (!executable) throw new Error('No verifier command configured. Set verification.command in .qmd-prover/config.yml or QMD_PROVER_VERIFIER.');
  let result;
  try { result = await run(executable.command, executable.args, JSON.stringify(packet)); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Verifier executable not found: ${executable.command}`);
    throw error;
  }
  if (result.code !== 0) throw new Error(`Verifier failed with exit ${result.code}: ${result.stderr.trim()}`);
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error('Verifier did not return valid JSON'); }
  if (!['correct', 'incorrect'].includes(report.verdict)) throw new Error('Verifier verdict must be "correct" or "incorrect"');
  for (const field of ['critical_errors', 'gaps']) if (!Array.isArray(report[field])) throw new Error(`Verifier field ${field} must be an array`);
  return {
    verdict: report.verdict,
    summary: String(report.summary ?? ''),
    critical_errors: report.critical_errors.map(String),
    gaps: report.gaps.map(String),
    repair_hints: String(report.repair_hints ?? '')
  };
}

function accepted(report) {
  return report.verdict === 'correct'
    && report.critical_errors.length === 0
    && report.gaps.length === 0;
}

async function verifierPacket(root, target, candidate, compilation) {
  const canonical = target.file ? await readLocatedBlock(path.join(root, target.file), target.id) : null;
  const proposed = await readLocatedProof(candidate.file, target.id);
  const byId = new Map(compilation.manifest.results.map((result) => [result.id, result]));
  const dependencies = [];
  for (const id of candidate.result.dependencies) {
    const result = byId.get(id);
    const located = result && await readLocatedBlock(path.join(root, result.file), id);
    dependencies.push({
      id,
      kind: result?.kind,
      title: result?.title,
      statement: located?.statement?.text ?? '',
      status: result?.status,
      source: result ? { file: result.file, line: result.line } : null
    });
  }
  return {
    schema_version: 1,
    target: {
      id: target.id,
      title: target.title,
      statement: canonical?.statement?.text ?? candidate.statement,
      proof: proposed?.proof?.text ?? '',
      cited_dependencies: candidate.result.dependencies,
      hypotheses: []
    },
    dependencies,
    verification: { fresh_context: true, backend: compilation.config.verification.backend, model: compilation.config.verification.model }
  };
}

export async function submitProof(root, proposalFile, options = {}) {
  root = path.resolve(root);
  proposalFile = path.resolve(proposalFile);
  const initial = await compileProject(root, { ...options, excludeFiles: [proposalFile] });
  if (!initial.ok) throw new Error('Project has structural errors; repair them before submitting a proof');
  const proposalCompilation = await compileProject(root, {
    ...options,
    files: [proposalFile],
    externalTargets: initial.manifest.results.map((result) => result.id),
    write: false
  });
  const proposalErrors = proposalCompilation.diagnostics.filter((item) => ![
    'DEPENDENCY_UNAVAILABLE', 'DEPENDENCY_UNKNOWN', 'IMPORT_FILE_MISSING', 'IMPORT_ID_MISSING', 'IMPORT_NOT_EXPORTED'
  ].includes(item.code));
  if (proposalErrors.length) throw new Error(`Proposal is structurally invalid: ${proposalErrors.map((item) => item.message).join('; ')}`);
  if (proposalCompilation.manifest.proofs.length !== 1 || proposalCompilation.manifest.results.length > 1) {
    throw new Error('A proof proposal must contain exactly one linked proof and at most one new result');
  }
  const proposalProof = proposalCompilation.manifest.proofs[0];
  const proposedResult = proposalCompilation.manifest.results[0] ?? null;
  const canonicalTarget = initial.manifest.results.find((result) => result.id === proposalProof.target);
  if (canonicalTarget && proposedResult) throw new Error(`Proposal must not redefine existing canonical result @${proposalProof.target}`);
  if (proposedResult && proposedResult.id !== proposalProof.target) throw new Error(`Proposal proof must target its proposed result @${proposedResult.id}`);
  if (!canonicalTarget && !proposedResult) throw new Error(`Proposal target @${proposalProof.target} does not exist in canonical QMD`);
  const isNewResult = !canonicalTarget;
  if (isNewResult && !options.destination) throw new Error('A new-result proposal requires a canonical destination');
  const target = canonicalTarget ?? { ...proposedResult, file: null, status: 'open' };
  const candidateResult = {
    ...target,
    proof_hash: proposalProof.proof_hash,
    proof_present: proposalProof.proof_present,
    dependencies: proposalProof.dependencies,
    uses: proposalProof.dependencies
  };
  if (!candidateResult.proof_present) throw new Error('Proposal proof is empty');
  if (target.status === 'verified') throw new Error(`@${target.id} is already verified; revoke it with a recorded reason before replacing its proof`);
  const destination = isNewResult ? path.resolve(root, options.destination) : path.join(root, target.file);
  const destinationRelative = path.relative(root, destination).split(path.sep).join('/');
  if (isNewResult && (destinationRelative.startsWith('../') || destinationRelative === AUX || destinationRelative.startsWith(`${AUX}/`))) {
    throw new Error('A new result must be promoted to canonical QMD outside .qmd-prover');
  }
  const scopeFile = isNewResult
    ? initial.manifest.files.find((item) => item.path === destinationRelative)
    : initial.manifest.files.find((item) => item.path === target.file);
  const proposalFileRecord = proposalCompilation.manifest.files[0];
  for (const dependency of candidateResult.dependencies) {
    const result = initial.manifest.results.find((item) => item.id === dependency);
    if (!result) throw new Error(`Proposal dependency @${dependency} does not exist`);
    if (result.file !== destinationRelative) {
      const declarations = scopeFile?.imports ?? (isNewResult ? proposalFileRecord?.imports ?? [] : []);
      const imported = declarations.some((item) => item.use.includes(dependency));
      if (!imported) throw new Error(`Proposal dependency @${dependency} is not imported by ${destinationRelative}`);
    }
    if (result.status !== 'verified') throw new Error(`Proposal dependency @${dependency} is not verified`);
  }

  const submissionId = newId('submission');
  const proposalId = newId('proposal');
  const proposalDir = path.join(root, AUX, 'proposals', proposalId);
  await mkdir(proposalDir, { recursive: true });
  const storedProposal = path.join(proposalDir, 'proposal.qmd');
  await copyFile(proposalFile, storedProposal);
  const dependencySnapshot = Object.fromEntries(candidateResult.dependencies.map((id) => {
    const item = initial.manifest.results.find((result) => result.id === id);
    return [id, sha256(`${item.statement_hash}:${item.proof_hash}:${item.status}`)];
  }));
  const metadata = {
    proposal_id: proposalId, submission_id: submissionId, target: target.id,
    created_at: new Date().toISOString(), statement_hash: candidateResult.statement_hash,
    proof_hash: candidateResult.proof_hash, dependency_snapshot: dependencySnapshot,
    mode: isNewResult ? 'new-result' : 'existing-result', destination: destinationRelative
  };
  await atomicJson(path.join(proposalDir, 'metadata.json'), metadata);
  await appendEvent(root, { type: 'proposal-stored', submission_id: submissionId, proposal_id: proposalId, target: target.id });

  const proposedLocated = isNewResult ? await readLocatedBlock(storedProposal, target.id) : null;
  const packet = await verifierPacket(root, target, {
    file: storedProposal,
    result: candidateResult,
    statement: proposedLocated?.statement?.text ?? ''
  }, initial);
  await appendEvent(root, { type: 'verification-started', submission_id: submissionId, target: target.id });
  const report = await invokeVerifier(packet, initial.config);
  const isAccepted = accepted(report);
  const reportRecord = {
    schema_version: 1, submission_id: submissionId, proposal_id: proposalId, target: target.id,
    backend: initial.config.verification.backend, model: initial.config.verification.model,
    formal_status: 'not-formal', human_review_status: 'not-reviewed',
    verified_at: new Date().toISOString(), ...report, accepted: isAccepted,
    packet_hash: sha256(JSON.stringify(packet)), statement_hash: candidateResult.statement_hash,
    proof_hash: candidateResult.proof_hash, dependency_snapshot: dependencySnapshot
  };
  await atomicJson(path.join(root, AUX, 'verification', `${submissionId}.json`), reportRecord);

  if (!isAccepted) {
    const rejectedDir = path.join(root, AUX, 'rejected', submissionId);
    await mkdir(rejectedDir, { recursive: true });
    await Promise.all([copyFile(storedProposal, path.join(rejectedDir, 'proposal.qmd')), atomicJson(path.join(rejectedDir, 'report.json'), reportRecord)]);
    await withWriteLock(root, async () => {
      const current = await compileProject(root, { ...options, excludeFiles: [proposalFile] });
      const currentTarget = current.manifest.results.find((result) => result.id === target.id);
      const targetIsCurrent = isNewResult
        ? !currentTarget
        : currentTarget && currentTarget.statement_hash === target.statement_hash && currentTarget.proof_hash === target.proof_hash;
      if (!targetIsCurrent) {
        await appendEvent(root, { type: 'submission-stale', submission_id: submissionId, target: target.id, reason: 'target-changed-before-rejection-recorded' });
        return;
      }
      const indexFile = path.join(root, AUX, 'verification', 'index.json');
      const index = await readJson(indexFile, {});
      if (!isNewResult) index[target.id] = {
        status: 'rejected', submission_id: submissionId, statement_hash: target.statement_hash,
        canonical_proof_hash: target.proof_hash, rejected_proof_hash: candidateResult.proof_hash
      };
      await atomicJson(indexFile, index);
      await appendEvent(root, { type: 'verification-rejected', submission_id: submissionId, target: target.id });
      await compileProject(root, { ...options, excludeFiles: [proposalFile] });
    });
    return { submission_id: submissionId, proposal_id: proposalId, target: target.id, status: 'rejected', report };
  }

  return withWriteLock(root, async () => {
    const current = await compileProject(root, { ...options, excludeFiles: [proposalFile] });
    if (!current.ok) throw new Error('Project became structurally invalid while verification was running');
    const currentTarget = current.manifest.results.find((result) => result.id === target.id);
    const targetIsCurrent = isNewResult
      ? !currentTarget
      : currentTarget && currentTarget.statement_hash === target.statement_hash && currentTarget.proof_hash === target.proof_hash;
    if (!targetIsCurrent) {
      await appendEvent(root, { type: 'submission-stale', submission_id: submissionId, target: target.id, reason: 'target-changed' });
      throw new Error(`Stale submission: @${target.id} changed while verification was running`);
    }
    for (const [id, snapshot] of Object.entries(dependencySnapshot)) {
      const item = current.manifest.results.find((result) => result.id === id);
      if (!item || sha256(`${item.statement_hash}:${item.proof_hash}:${item.status}`) !== snapshot) {
        await appendEvent(root, { type: 'submission-stale', submission_id: submissionId, target: target.id, reason: `dependency-${id}-changed` });
        throw new Error(`Stale submission: dependency @${id} changed while verification was running`);
      }
    }
    let original = null;
    try { original = await readFile(destination, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const proposed = await readLocatedProof(storedProposal, target.id);
    let merged;
    if (isNewResult) {
      const fullProposal = await readFile(storedProposal, 'utf8');
      const newResult = await readLocatedBlock(storedProposal, target.id);
      const payload = `${newResult.raw.trim()}\n\n${proposed.raw.trim()}\n`;
      const frontMatter = fullProposal.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0].trim() ?? '';
      merged = original == null ? `${frontMatter ? `${frontMatter}\n\n` : ''}${payload}` : `${original.replace(/\s*$/, '')}\n\n${payload}`;
    } else {
      const canonical = await readLocatedBlock(destination, target.id);
      merged = mergeProof(canonical, proposed);
    }
    const indexFile = path.join(root, AUX, 'verification', 'index.json');
    const previousIndex = await readJson(indexFile, {});
    const nextIndex = structuredClone(previousIndex);
    nextIndex[target.id] = {
      status: 'verified', submission_id: submissionId, statement_hash: target.statement_hash,
      proof_hash: candidateResult.proof_hash, backend: initial.config.verification.backend,
      formal_status: 'not-formal', human_review_status: 'not-reviewed'
    };
    try {
      await atomicWrite(destination, merged);
      await atomicJson(indexFile, nextIndex);
      const rebuilt = await compileProject(root, { ...options, excludeFiles: [proposalFile] });
      const mergedTarget = rebuilt.manifest.results.find((result) => result.id === target.id);
      if (!rebuilt.ok || mergedTarget?.status !== 'verified') throw new Error('Post-merge inspection did not confirm a verified target');
    } catch (error) {
      if (original == null) await rm(destination, { force: true });
      else await atomicWrite(destination, original);
      await atomicJson(indexFile, previousIndex);
      await compileProject(root, { ...options, excludeFiles: [proposalFile] });
      throw error;
    }
    const acceptedDir = path.join(root, AUX, 'accepted', submissionId);
    await mkdir(acceptedDir, { recursive: true });
    await Promise.all([copyFile(storedProposal, path.join(acceptedDir, 'proposal.qmd')), atomicJson(path.join(acceptedDir, 'report.json'), reportRecord)]);
    await appendEvent(root, { type: 'verification-accepted', submission_id: submissionId, target: target.id });
    return { submission_id: submissionId, proposal_id: proposalId, target: target.id, status: 'verified', report };
  });
}

export async function showVerification(root, submissionId) {
  return readJson(path.join(path.resolve(root), AUX, 'verification', `${submissionId}.json`));
}

export async function revokeVerification(root, requested, reason, options = {}) {
  if (!reason?.trim()) throw new Error('Revocation requires a nonempty --reason');
  const id = requested.replace(/^@/, '');
  return withWriteLock(path.resolve(root), async () => {
    const compilation = await compileProject(root, options);
    const result = compilation.manifest.results.find((item) => item.id === id);
    if (!result) throw new Error(`Unknown theorem: @${id}`);
    if (result.status !== 'verified') throw new Error(`@${id} is not currently verified`);
    const indexFile = path.join(root, AUX, 'verification', 'index.json');
    const index = await readJson(indexFile, {});
    index[id] = { ...index[id], status: 'revoked', revoked_at: new Date().toISOString(), reason };
    await atomicJson(indexFile, index);
    await appendEvent(root, { type: 'verification-revoked', target: id, reason });
    await compileProject(root, options);
    return { target: id, status: 'revoked', reason };
  });
}
