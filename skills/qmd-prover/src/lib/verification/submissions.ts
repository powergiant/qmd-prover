import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { externalPolicyHash, readExternalPolicy } from '../infrastructure/external.js';
import { appendEvent, atomicJson, atomicWrite, AUX, newId, readJson, sha256, stableJson, withWriteLock } from '../infrastructure/files.js';
import { compileProject } from '../semantic/compiler.js';
import { locateDiv, readLocatedBlock, readLocatedProof, mergeProof, setFactMarker } from '../semantic/source.js';
import { accepted, buildVerifierPacket, checkerContract, invokeVerifier, readVerifierDecision, verificationKey } from './protocol.js';
import { hasErrorCode } from '../shared/core.js';
import type { Compilation, ImportDeclaration, JsonObject, RuntimeOptions, SemanticResult, SubmissionResult, VerifierPacket, VerifierReport } from '../shared/types.js';

type SubmissionTarget = Omit<SemanticResult, 'file'> & { file: string | null };
interface ProofCandidate {
  file: string;
  result: SubmissionTarget;
  statement: string;
  scope?: ImportDeclaration[];
}

async function verifierPacket(root: string, target: SubmissionTarget, candidate: ProofCandidate, compilation: Compilation, externalBasis: JsonObject): Promise<VerifierPacket> {
  const canonical = target.file ? await readLocatedBlock(path.join(root, target.file), target.id) : null;
  const proposed = await readLocatedProof(candidate.file, target.id);
  const byId = new Map<string, SemanticResult>(compilation.manifest.results.map((result) => [result.id, result]));
  const dependencies: JsonObject[] = [];
  for (const id of candidate.result.dependencies) {
    const result = byId.get(id);
    const located = result && await readLocatedBlock(path.join(root, result.file), id);
    dependencies.push({
      id,
      kind: result?.kind,
      title: result?.title,
      semantic_text: located?.statement?.text ?? '',
      statement: located?.statement?.text ?? '',
      status: result?.status,
      identity: result ? { statement_hash: result.statement_hash, proof_hash: result.proof_hash } : null,
      source: result ? { file: result.file } : null
    });
  }
  const sourceFile = compilation.manifest.files.find((file) => file.path === target.file);
  return buildVerifierPacket({
    target: {
      id: target.id,
      kind: target.kind,
      title: target.title,
      semantic_text: canonical?.statement?.text ?? candidate.statement,
      ...(target.kind === 'definition'
        ? { construction: canonical?.statement?.text ?? candidate.statement }
        : { statement: canonical?.statement?.text ?? candidate.statement }),
      proof: proposed?.proof?.text ?? '',
      cited_dependencies: candidate.result.dependencies,
      identity: { statement_hash: target.statement_hash, proof_hash: candidate.result.proof_hash },
      source: { file: target.file ?? candidate.file }
    },
    dependencies,
    externalBasis,
    scope: candidate.scope ?? sourceFile?.imports ?? [],
    config: compilation.config
  });
}

export async function submitProof(root: string, proposalFile: string, options: RuntimeOptions = {}): Promise<SubmissionResult> {
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
  if (proposalProof.marker) throw new Error('A proposal must not contain OPEN, REJECTED, VERIFIED, or REVOKED control markers');
  const proposedResult = proposalCompilation.manifest.results[0] ?? null;
  const canonicalTarget = initial.manifest.results.find((result) => result.id === proposalProof.target);
  if (canonicalTarget && proposedResult) throw new Error(`Proposal must not redefine existing canonical result @${proposalProof.target}`);
  if (proposedResult && proposedResult.id !== proposalProof.target) throw new Error(`Proposal proof must target its proposed result @${proposedResult.id}`);
  if (!canonicalTarget && !proposedResult) throw new Error(`Proposal target @${proposalProof.target} does not exist in canonical QMD`);
  const isNewResult = !canonicalTarget;
  if (isNewResult && !options.destination) throw new Error('A new-result proposal requires a canonical destination');
  let target: SubmissionTarget;
  if (canonicalTarget) target = canonicalTarget;
  else {
    if (!proposedResult) throw new Error(`Proposal target @${proposalProof.target} does not exist in canonical QMD`);
    target = { ...proposedResult, file: null, status: 'open' };
  }
  const candidateResult = {
    ...target,
    proof_hash: proposalProof.proof_hash,
    proof_present: proposalProof.proof_present,
    dependencies: proposalProof.dependencies,
    uses: proposalProof.dependencies
  };
  if (!candidateResult.proof_present) throw new Error('Proposal proof is empty');
  if (target.status === 'verified') throw new Error(`@${target.id} is already verified; revoke it with a recorded reason before replacing its proof`);
  let destination: string;
  if (isNewResult) {
    if (!options.destination) throw new Error('A new-result proposal requires a canonical destination');
    destination = path.resolve(root, options.destination);
  } else {
    if (!target.file) throw new Error(`Canonical target @${target.id} has no source file`);
    destination = path.join(root, target.file);
  }
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
  const externalBasis = await readExternalPolicy(root);
  const externalBasisHash = externalPolicyHash(externalBasis);
  const proposalDir = path.join(root, AUX, 'proposals', proposalId);
  await mkdir(proposalDir, { recursive: true });
  const storedProposal = path.join(proposalDir, 'proposal.qmd');
  await copyFile(proposalFile, storedProposal);
  const dependencySnapshot = Object.fromEntries(candidateResult.dependencies.map((id) => {
    const item = initial.manifest.results.find((result) => result.id === id);
    if (!item) throw new Error(`Proposal dependency @${id} disappeared`);
    return [id, sha256(`${item.statement_hash}:${item.proof_hash}:${item.status}`)];
  }));
  const metadata = {
    proposal_id: proposalId, submission_id: submissionId, target: target.id,
    created_at: new Date().toISOString(), statement_hash: candidateResult.statement_hash,
    proof_hash: candidateResult.proof_hash, dependency_snapshot: dependencySnapshot,
    external_basis_hash: externalBasisHash,
    mode: isNewResult ? 'new-result' : 'existing-result', destination: destinationRelative
  };
  await atomicJson(path.join(proposalDir, 'metadata.json'), metadata);
  await appendEvent(root, { type: 'proposal-stored', submission_id: submissionId, proposal_id: proposalId, target: target.id });

  const proposedLocated = isNewResult ? await readLocatedBlock(storedProposal, target.id) : null;
  const packet = await verifierPacket(root, target, {
    file: storedProposal,
    result: candidateResult,
    statement: proposedLocated?.statement?.text ?? '',
    scope: isNewResult ? proposalFileRecord?.imports ?? [] : undefined
  }, initial, externalBasis);
  const verifierKey = verificationKey(packet);
  const cachedDecision = await readVerifierDecision(root, verifierKey, packet);
  let report: VerifierReport;
  let decisionId: string;
  let decisionSource: string;
  if (cachedDecision.record) {
    report = cachedDecision.record.report;
    decisionId = cachedDecision.record.submission_id;
    decisionSource = 'verification-cache';
    await appendEvent(root, { type: 'verification-cache-hit', submission_id: submissionId, decision_id: decisionId, target: target.id, verification_key: verifierKey });
  } else {
    await appendEvent(root, { type: 'verification-started', submission_id: submissionId, target: target.id });
    report = await invokeVerifier(packet, initial.config);
    decisionId = submissionId;
    decisionSource = 'independent-verifier';
  }
  const isAccepted = accepted(report);
  const reportRecord = {
    schema_version: 2, submission_id: submissionId, proposal_id: proposalId, target: target.id,
    backend: initial.config.verification.backend, model: initial.config.verification.model,
    formal_status: 'not-formal', human_review_status: 'not-reviewed',
    verified_at: new Date().toISOString(), ...report, report, accepted: isAccepted,
    packet_hash: sha256(stableJson(packet, 0)), verification_key: verifierKey,
    checker_contract: checkerContract(initial.config), statement_hash: candidateResult.statement_hash,
    title_hash: target.title_hash, kind: target.kind,
    proof_hash: candidateResult.proof_hash, dependency_snapshot: dependencySnapshot,
    external_basis_hash: externalBasisHash,
    scope: packet.scope, source_file: destinationRelative,
    source: decisionSource,
    ...(decisionId !== submissionId ? { decision_id: decisionId } : {})
  };
  const writes = [atomicJson(path.join(root, AUX, 'verification', `${submissionId}.json`), reportRecord)];
  if (!cachedDecision.record) writes.push(atomicJson(cachedDecision.location.file, reportRecord));
  await Promise.all(writes);

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
      const index = await readJson<Record<string, JsonObject>>(indexFile, {});
      if (!isNewResult) index[target.id] = {
        status: 'rejected', submission_id: submissionId, statement_hash: target.statement_hash,
        title_hash: target.title_hash, kind: target.kind,
        canonical_proof_hash: target.proof_hash, rejected_proof_hash: candidateResult.proof_hash,
        dependency_snapshot: dependencySnapshot, external_basis_hash: externalBasisHash,
        verification_key: verifierKey, checker_contract: checkerContract(initial.config),
        scope: packet.scope, source_file: destinationRelative,
        record: `${AUX}/verification/${submissionId}.json`
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
    if (externalPolicyHash(await readExternalPolicy(root)) !== externalBasisHash) {
      await appendEvent(root, { type: 'submission-stale', submission_id: submissionId, target: target.id, reason: 'external-basis-changed' });
      throw new Error('Stale submission: external basis changed while verification was running');
    }
    let original = null;
    try { original = await readFile(destination, 'utf8'); } catch (error) { if (!hasErrorCode(error, 'ENOENT')) throw error; }
    const proposed = await readLocatedProof(storedProposal, target.id);
    let merged;
    if (isNewResult) {
      const fullProposal = await readFile(storedProposal, 'utf8');
      const newResult = await readLocatedBlock(storedProposal, target.id);
      if (!newResult || !proposed) throw new Error('Stored new-result proposal is incomplete');
      const payload = `${newResult.raw.trim()}\n\n${proposed.raw.trim()}\n`;
      const frontMatter = fullProposal.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0].trim() ?? '';
      merged = original == null ? `${frontMatter ? `${frontMatter}\n\n` : ''}${payload}` : `${original.replace(/\s*$/, '')}\n\n${payload}`;
    } else {
      const canonical = await readLocatedBlock(destination, target.id);
      merged = mergeProof(canonical, proposed);
    }
    merged = setFactMarker(merged, target.id, target.kind, 'VERIFIED');
    const indexFile = path.join(root, AUX, 'verification', 'index.json');
    const cacheFile = path.join(root, AUX, 'verification', 'facts', `${target.id}.json`);
    const previousIndex = await readJson<Record<string, JsonObject>>(indexFile, {});
    const nextIndex = structuredClone(previousIndex);
    let previousCache = null;
    try { previousCache = await readFile(cacheFile, 'utf8'); } catch (error) { if (!hasErrorCode(error, 'ENOENT')) throw error; }
    const scope = current.manifest.files.find((item) => item.path === destinationRelative)?.imports
      ?? (isNewResult ? proposalFileRecord?.imports ?? [] : []);
    const factCache = {
      schema_version: 3,
      id: target.id,
      source: { file: destinationRelative, line: locateDiv(merged, target.id)?.startLine },
      statement: String(packet.target.construction ?? packet.target.statement ?? ''),
      proof: packet.target.proof,
      statement_hash: target.statement_hash,
      title_hash: target.title_hash,
      kind: target.kind,
      proof_hash: candidateResult.proof_hash,
      dependencies: packet.dependencies,
      dependency_snapshot: dependencySnapshot,
      external_basis: externalBasis,
      external_basis_hash: externalBasisHash,
      scope,
      graph_snapshot_id: current.graph.snapshot_id,
      verification_key: verifierKey,
      checker_contract: checkerContract(initial.config),
      verification: { submission_id: submissionId, backend: initial.config.verification.backend, model: initial.config.verification.model, report }
    };
    nextIndex[target.id] = {
      status: 'verified', submission_id: submissionId, statement_hash: target.statement_hash,
      title_hash: target.title_hash, kind: target.kind,
      proof_hash: candidateResult.proof_hash, backend: initial.config.verification.backend,
      formal_status: 'not-formal', human_review_status: 'not-reviewed',
      dependency_snapshot: dependencySnapshot,
      external_basis_hash: externalBasisHash,
      verification_key: verifierKey,
      checker_contract: checkerContract(initial.config),
      record: `${AUX}/verification/${submissionId}.json`,
      cache: `${AUX}/verification/facts/${target.id}.json`
    };
    try {
      await atomicWrite(destination, merged);
      await atomicJson(cacheFile, factCache);
      await atomicJson(indexFile, nextIndex);
      const rebuilt = await compileProject(root, { ...options, excludeFiles: [proposalFile] });
      const mergedTarget = rebuilt.manifest.results.find((result) => result.id === target.id);
      if (!rebuilt.ok || mergedTarget?.status !== 'verified') throw new Error('Post-merge inspection did not confirm a verified target');
    } catch (error) {
      if (original == null) await rm(destination, { force: true });
      else await atomicWrite(destination, original);
      if (previousCache == null) await rm(cacheFile, { force: true });
      else await atomicWrite(cacheFile, previousCache);
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

export async function showVerification(root: string, submissionId: string): Promise<JsonObject> {
  const directory = path.join(path.resolve(root), AUX, 'verification');
  try { return await readJson<JsonObject>(path.join(directory, `${submissionId}.json`)); }
  catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    const checks = path.join(directory, 'checks');
    let entries: string[] = [];
    try { entries = await readdir(checks); } catch (checksError) { if (!hasErrorCode(checksError, 'ENOENT')) throw checksError; }
    for (const name of entries.filter((entry) => entry.endsWith('.json')).sort()) {
      const record = await readJson<JsonObject>(path.join(checks, name));
      if (record.submission_id === submissionId) return record;
    }
    throw error;
  }
}

export async function revokeVerification(root: string, requested: string, reason: string, options: RuntimeOptions = {}): Promise<SubmissionResult> {
  if (!reason?.trim()) throw new Error('Revocation requires a nonempty --reason');
  const id = requested.replace(/^@/, '');
  return withWriteLock(path.resolve(root), async () => {
    const compilation = await compileProject(root, options);
    const result = compilation.manifest.results.find((item) => item.id === id);
    if (!result) throw new Error(`Unknown theorem: @${id}`);
    if (result.status !== 'verified') throw new Error(`@${id} is not currently verified`);
    const indexFile = path.join(root, AUX, 'verification', 'index.json');
    const index = await readJson<Record<string, JsonObject>>(indexFile, {});
    const sourceFile = path.join(path.resolve(root), result.file);
    const originalSource = await readFile(sourceFile, 'utf8');
    const previousIndex = structuredClone(index);
    index[id] = { ...index[id], status: 'revoked', revoked_at: new Date().toISOString(), reason };
    try {
      await atomicWrite(sourceFile, setFactMarker(originalSource, id, result.kind, 'REVOKED'));
      await atomicJson(indexFile, index);
      const rebuilt = await compileProject(root, options);
      if (!rebuilt.ok || rebuilt.manifest.results.find((item) => item.id === id)?.status !== 'revoked') throw new Error('Post-write inspection did not confirm revocation');
    } catch (error) {
      await atomicWrite(sourceFile, originalSource);
      await atomicJson(indexFile, previousIndex);
      await compileProject(root, options);
      throw error;
    }
    await appendEvent(root, { type: 'verification-revoked', target: id, reason });
    return { target: id, status: 'revoked', reason };
  });
}
