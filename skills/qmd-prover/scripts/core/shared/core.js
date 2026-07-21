export const AUX = '.qmd-prover';
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
export const STATUS_VALUES = ['verified', 'disproved', 'rejected'];
export const SEMANTIC_PREFIX_PATTERN = /^(def|lem|thm|prp|cor)-/;
export const SEMANTIC_ID_PATTERN = /^(def|lem|thm|prp|cor)-[A-Za-z0-9._:-]+$/;
export const RESULT_KINDS = [
    'definition', 'lemma', 'theorem', 'proposition', 'corollary'
];
export const KIND_BY_PREFIX = {
    def: 'definition',
    lem: 'lemma',
    thm: 'theorem',
    prp: 'proposition',
    cor: 'corollary'
};
export function asErrorLike(error) {
    return error && typeof error === 'object' ? error : { message: String(error) };
}
export function errorMessage(error) {
    return asErrorLike(error).message ?? String(error);
}
export function hasErrorCode(error, code) {
    return asErrorLike(error).code === code;
}
export function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function asRecord(value) {
    return isRecord(value) ? value : {};
}
export function asString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}
export function asStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
export function asArray(value) {
    return Array.isArray(value) ? value : [];
}
export function uniqueSorted(values, compare) {
    const unique = [...new Set(values)];
    return compare ? unique.sort(compare) : unique.sort();
}
export function indexBy(values, key) {
    return new Map([...values].map((value) => [key(value), value]));
}
/** Index a collection by its `id` field — the common special case of {@link indexBy}. */
export function byId(items) {
    return indexBy(items, (item) => item.id);
}
export function pushToMap(map, key, value) {
    const values = map.get(key);
    if (values)
        values.push(value);
    else
        map.set(key, [value]);
}
