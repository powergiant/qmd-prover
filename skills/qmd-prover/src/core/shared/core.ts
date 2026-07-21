import type { UnknownRecord } from './types.js';

export const AUX = '.qmd-prover';

/** The mathematical role a semantic result plays. Paired with {@link RESULT_KINDS}. */
export type ResultKind = 'definition' | 'lemma' | 'theorem' | 'proposition' | 'corollary' | 'unknown';

/** Stable output schema for every operation result and persisted snapshot. */
export const SCHEMA_VERSION = 8;

// The label model lives entirely in div attributes, never in body paragraphs. The author writes
// four flags; the engine projects one attribute back after inspection.
/** Class flag: the proof div carries a proposed refutation, checked in refutation mode. */
export const DISPROOF_CLASS = 'disproof';
/** Class flag: the proof is deliberately unfinished — never checked, and the fact stays open. */
export const DRAFT_CLASS = 'draft';
/** Class flag: the fact is taken as given — never checked, composes as verified, recorded as an assumption. */
export const ASSUMED_CLASS = 'assumed';
/** Class flag: the proof (or fact) is detached — kept in the file for memory, never checked. */
export const ABANDON_CLASS = 'abandon';
/** Key the engine writes a checked fact's local verdict into; never read back, never trusted. */
export const STATUS_ATTR = 'status';
/** The three conclusive verdicts the engine may project into a fact's `status` attribute. */
export const STATUS_VALUES = ['verified', 'disproved', 'rejected'] as const;
export type FactStatusValue = typeof STATUS_VALUES[number];

export const SEMANTIC_PREFIX_PATTERN = /^(def|lem|thm|prp|cor)-/;
export const SEMANTIC_ID_PATTERN = /^(def|lem|thm|prp|cor)-[A-Za-z0-9._:-]+$/;
export const RESULT_KINDS: readonly ResultKind[] = [
  'definition', 'lemma', 'theorem', 'proposition', 'corollary'
];
export const KIND_BY_PREFIX: Readonly<Record<string, ResultKind>> = {
  def: 'definition',
  lem: 'lemma',
  thm: 'theorem',
  prp: 'proposition',
  cor: 'corollary'
};

export interface ErrorLike {
  message?: string;
  stack?: string;
  code?: string | number;
  exitCode?: number;
  [key: string]: unknown;
}

export function asErrorLike(error: unknown): ErrorLike {
  return error && typeof error === 'object' ? error as ErrorLike : { message: String(error) };
}

export function errorMessage(error: unknown): string {
  return asErrorLike(error).message ?? String(error);
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return asErrorLike(error).code === code;
}

export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function uniqueSorted<T>(values: Iterable<T>, compare?: (left: T, right: T) => number): T[] {
  const unique = [...new Set(values)];
  return compare ? unique.sort(compare) : unique.sort() as T[];
}

export function indexBy<T, K>(values: Iterable<T>, key: (value: T) => K): Map<K, T> {
  return new Map([...values].map((value) => [key(value), value]));
}

/** Index a collection by its `id` field — the common special case of {@link indexBy}. */
export function byId<T extends { id: string }>(items: Iterable<T>): Map<string, T> {
  return indexBy(items, (item) => item.id);
}

export function pushToMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}
