import path from 'node:path';
import { AUX, readJson, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { verificationOutcome, verifierErrorDetails } from './protocol.js';
import { asErrorLike, asRecord, asStringArray, hasErrorCode, isRecord } from '../shared/core.js';
import type {
  AiCheck, JsonObject, UnknownRecord, VerificationOutcome, VerifierPacket, VerifierReport
} from '../shared/types.js';

export interface LocalOutcome extends AiCheck {
  verification_key?: string;
  failed_target?: string;
  failure_report?: string;
}

export interface VerificationCacheRecord extends JsonObject {
  target: string;
  verification_key: string;
  packet_hash: string;
  checker_contract: JsonObject;
  report: VerifierReport;
  accepted: boolean;
  outcome: VerificationOutcome;
}

export interface CacheLookup {
  location: { relative: string; file: string };
  record: VerificationCacheRecord | null;
  invalid: boolean;
}

export function cacheLocation(root: string, key: string): { relative: string; file: string } {
  const digest = key.replace(/^sha256:/, '');
  const file = path.join(root, AUX, 'verification', 'checks', `${digest}.json`);
  return { relative: relativePosix(root, file), file };
}

function verifierReport(value: unknown): VerifierReport | null {
  if (!isRecord(value) || !['correct', 'incorrect', 'disproved'].includes(String(value.verdict))) return null;
  const refutation = typeof value.refutation === 'string' ? value.refutation : '';
  if (value.verdict === 'disproved' && !refutation.trim()) return null;
  return {
    verdict: value.verdict as VerifierReport['verdict'],
    summary: typeof value.summary === 'string' ? value.summary : '',
    critical_errors: asStringArray(value.critical_errors),
    gaps: asStringArray(value.gaps),
    nonblocking_comments: asStringArray(value.nonblocking_comments),
    repair_hints: typeof value.repair_hints === 'string' ? value.repair_hints : '',
    refutation
  };
}

export async function cachedDecision(root: string, target: string, key: string, packet: VerifierPacket): Promise<CacheLookup> {
  const location = cacheLocation(root, key);
  let record: UnknownRecord;
  try { record = await readJson<UnknownRecord>(location.file); } catch (error) {
    return { location, record: null, invalid: !hasErrorCode(error, 'ENOENT') };
  }
  const report = verifierReport(record.report);
  if (!report || typeof record.accepted !== 'boolean') return { location, record: null, invalid: true };
  const outcome = verificationOutcome(report, packet);
  const valid = record?.target === target
    && record?.verification_key === key
    && record?.packet_hash === sha256(stableJson(packet, 0))
    && stableJson(record?.checker_contract ?? {}, 0) === stableJson(packet.checker_contract ?? {}, 0)
    && record.accepted === (outcome !== 'rejected')
    && record.outcome === outcome;
  const cached: VerificationCacheRecord | null = valid && report ? {
    ...record,
    target,
    verification_key: key,
    packet_hash: String(record.packet_hash),
    checker_contract: asRecord(record.checker_contract),
    report,
    accepted: record.accepted,
    outcome
  } : null;
  return { location, record: cached, invalid: !valid };
}

export function verifierFailure(error: unknown, target: string, inherited = false): LocalOutcome {
  const failure = asErrorLike(error);
  const details = inherited ? failure.details : verifierErrorDetails(error);
  return {
    status: 'error',
    code: String(failure.code ?? 'VERIFIER_FAILED'),
    error: inherited
      ? `Local conditional verification stopped after the verifier command failed while checking @${target}`
      : failure.message,
    remediation: 'Repair verification.command or QMD_PROVER_VERIFIER, then rerun inspection. The local result remains unverified.',
    ...(isRecord(details) ? { details } : {}),
    fatal: true,
    ...(inherited ? { inherited: true, failed_target: target } : {})
  };
}
