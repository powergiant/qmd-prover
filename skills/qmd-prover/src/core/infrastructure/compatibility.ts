import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AUX, readJson } from './files.js';
import { readCanonicalContract, contractVersionIn } from './contract.js';
import { SCHEMA_VERSION, asRecord, asString } from '../shared/core.js';
import { VERIFIER_PROTOCOL_VERSION } from '../verification/protocol.js';
import type { UnknownRecord } from '../shared/types.js';

// Version identity and the soft compatibility gate.
//
// qmd-prover is installed as one PATH binary (`qmd-prover`) while each project
// carries its own on-disk state and contract. Those two can drift: a project's
// snapshot schema, cached verifier protocol, or `AGENTS.md` contract block may
// have been written by a different engine version. This module reports that drift
// as a warning; it never refuses to run. The caller decides where the warnings go
// (stderr for humans, a JSON field for `doctor`).

export interface EngineVersions {
  /** The installed tool version (package.json). */
  tool: string;
  /** On-disk snapshot/manifest data format. */
  schema: number;
  /** Verifier stdin/stdout packet protocol. */
  verifier_protocol: number;
  /** Canonical project-contract managed-block version shipped with the engine. */
  contract: number;
}

export interface CompatibilityWarning {
  kind: 'schema' | 'contract' | 'verifier-protocol';
  engine: number;
  project: number;
  message: string;
}

/** Walk up from this module to the qmd-prover package.json and read its version. */
async function packageVersion(): Promise<string> {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const pkg = asRecord(JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')));
      if (pkg.name === 'qmd-prover') return asString(pkg.version, '0.0.0');
    } catch { /* not here; keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

/** The versions the running engine implements. */
export async function engineVersions(): Promise<EngineVersions> {
  const [tool, contract] = await Promise.all([
    packageVersion(),
    readCanonicalContract().then((canonical) => canonical.version).catch(() => 0)
  ]);
  return { tool, schema: SCHEMA_VERSION, verifier_protocol: VERIFIER_PROTOCOL_VERSION, contract };
}

async function schemaOnDisk(root: string): Promise<number | null> {
  try {
    const pointer = await readJson<{ schema_version?: number }>(path.join(root, AUX, 'graphs', 'latest.json'));
    return typeof pointer.schema_version === 'number' ? pointer.schema_version : null;
  } catch { return null; }
}

async function contractInProject(root: string): Promise<number | null> {
  try {
    return contractVersionIn(await readFile(path.join(root, 'AGENTS.md'), 'utf8'));
  } catch { return null; }
}

async function verifierProtocolOnDisk(root: string): Promise<number | null> {
  try {
    const directory = path.join(root, AUX, 'verification', 'checks');
    const entry = (await readdir(directory)).find((name) => name.endsWith('.json'));
    if (!entry) return null;
    const record = await readJson<UnknownRecord>(path.join(directory, entry));
    const protocol = asRecord(asRecord(record.checker_contract).protocol);
    return typeof protocol.version === 'number' ? protocol.version : null;
  } catch { return null; }
}

/**
 * Compare the running engine against a project's persisted state and contract.
 * Returns one warning per detected mismatch; an empty array when everything the
 * project has on disk matches, or when the project has no such state yet. This is
 * best-effort and never throws: a missing or unreadable input yields no warning.
 */
export async function collectCompatibilityWarnings(root: string): Promise<CompatibilityWarning[]> {
  const engine = await engineVersions();
  const [schema, contract, protocol] = await Promise.all([
    schemaOnDisk(root),
    contractInProject(root),
    verifierProtocolOnDisk(root)
  ]);
  const warnings: CompatibilityWarning[] = [];
  if (schema !== null && schema !== engine.schema) {
    warnings.push({
      kind: 'schema', engine: engine.schema, project: schema,
      message: `Project snapshot uses data schema v${schema}, but qmd-prover ${engine.tool} writes schema v${engine.schema}. The old snapshot is ignored and rebuilt on the next 'qmd-prover inspect project'.`
    });
  }
  if (contract !== null && contract !== engine.contract) {
    warnings.push({
      kind: 'contract', engine: engine.contract, project: contract,
      message: `Project AGENTS.md carries contract v${contract}, but qmd-prover ${engine.tool} ships contract v${engine.contract}. Review the differences and, if intended, run 'qmd-prover init --sync-contract'.`
    });
  }
  if (protocol !== null && protocol !== engine.verifier_protocol) {
    warnings.push({
      kind: 'verifier-protocol', engine: engine.verifier_protocol, project: protocol,
      message: `Cached verifier decisions use protocol v${protocol}, but qmd-prover ${engine.tool} uses protocol v${engine.verifier_protocol}. Affected proofs are re-verified on the next inspection.`
    });
  }
  return warnings;
}
