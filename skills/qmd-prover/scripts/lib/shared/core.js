export const AUX = '.qmd-prover';
export const CONTROL_MARKERS = ['OPEN', 'REJECTED', 'VERIFIED', 'REVOKED'];
export const CONTROL_MARKER_SET = new Set(CONTROL_MARKERS);
export function isControlMarker(value) {
    return typeof value === 'string' && CONTROL_MARKER_SET.has(value);
}
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
export function pushToMap(map, key, value) {
    const values = map.get(key);
    if (values)
        values.push(value);
    else
        map.set(key, [value]);
}
