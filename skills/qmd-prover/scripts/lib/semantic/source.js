import { readFile } from 'node:fs/promises';
import { CONTROL_MARKER_SET } from '../shared/core.js';
function parseFence(line) {
    const match = line.match(/^(\s*)(:{3,})\s*(?:\{([^}]*)\})?\s*$/);
    return match ? { indent: match[1].length, length: match[2].length, attrs: match[3] ?? '' } : null;
}
function parseAttrs(source = '') {
    const tokens = source.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    const id = tokens.find((token) => token.startsWith('#'))?.slice(1) ?? '';
    const classes = tokens.filter((token) => token.startsWith('.')).map((token) => token.slice(1));
    const values = {};
    for (const token of tokens) {
        const equals = token.indexOf('=');
        if (equals < 1)
            continue;
        const key = token.slice(0, equals);
        const raw = token.slice(equals + 1);
        values[key] = raw.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, double, single) => double ?? single);
    }
    return { id, classes, values };
}
export function locateDivs(source) {
    const lines = source.split(/(?<=\n)/);
    let offset = 0;
    const stack = [];
    const found = [];
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
        const line = lines[lineNumber];
        const fence = parseFence(line.replace(/\r?\n$/, ''));
        if (fence) {
            if (!fence.attrs) {
                const open = stack.pop();
                if (open)
                    found.push({ ...open, end: offset + line.length, endLine: lineNumber + 1 });
            }
            else
                stack.push({ attrs: parseAttrs(fence.attrs), rawAttrs: fence.attrs, start: offset, startLine: lineNumber + 1, bodyStart: offset + line.length });
        }
        offset += line.length;
    }
    return found.sort((left, right) => left.start - right.start);
}
export function locateDiv(source, id) {
    return locateDivs(source).find((div) => div.attrs.id === id) ?? null;
}
export function locateProof(source, target) {
    return locateDivs(source).find((div) => div.attrs.classes.includes('proof') && div.attrs.values.of?.replace(/^@/, '') === target.replace(/^@/, '')) ?? null;
}
function body(source, div) {
    if (!div)
        return null;
    const raw = source.slice(div.bodyStart, div.end);
    const closing = raw.lastIndexOf(':::');
    const bodyEnd = div.bodyStart + Math.max(0, closing);
    return { bodyStart: div.bodyStart, bodyEnd, text: source.slice(div.bodyStart, bodyEnd).trim() };
}
function definitionMarkerBody(source, div) {
    const located = body(source, div);
    if (!located)
        return null;
    const raw = source.slice(located.bodyStart, located.bodyEnd);
    const normalized = raw.replace(/\r\n/g, '\n');
    const paragraphs = normalized.split(/\n[ \t]*\n/);
    const last = paragraphs.findLastIndex((paragraph) => paragraph.trim() !== '');
    const marker = last >= 0 && CONTROL_MARKER_SET.has(paragraphs[last].trim()) ? paragraphs[last].trim() : null;
    if (!marker)
        return { ...located, marker: null };
    const trimmed = raw.replace(/[ \t\r\n]+$/, '');
    const markerLine = new RegExp(`(?:^|\\r?\\n[ \\t]*\\r?\\n)[ \\t]*${marker}[ \\t]*$`);
    const match = markerLine.exec(trimmed);
    if (!match)
        return { ...located, marker: null };
    const construction = trimmed.slice(0, match.index).trim();
    return { ...located, text: construction, marker };
}
export async function readLocatedBlock(file, id) {
    const source = await readFile(file, 'utf8');
    const div = locateDiv(source, id);
    if (!div)
        return null;
    const proofDiv = locateProof(source, id);
    const statement = div.attrs.classes.includes('definition') ? definitionMarkerBody(source, div) : body(source, div);
    return {
        source,
        div,
        raw: source.slice(div.start, div.end),
        statement,
        marker: statement?.marker ?? null,
        proof: proofDiv ? body(source, proofDiv) : null,
        proofDiv
    };
}
export async function readLocatedProof(file, id) {
    const source = await readFile(file, 'utf8');
    const proofDiv = locateProof(source, id);
    return proofDiv ? { source, proofDiv, proof: body(source, proofDiv), raw: source.slice(proofDiv.start, proofDiv.end) } : null;
}
export function mergeProof(canonical, candidate) {
    if (!canonical?.div || !candidate?.proofDiv)
        throw new Error('Canonical result and linked proposal proof are required');
    const proofText = candidate.source.slice(candidate.proofDiv.start, candidate.proofDiv.end).trim();
    if (canonical.proofDiv) {
        return `${canonical.source.slice(0, canonical.proofDiv.start)}${proofText}${canonical.source.slice(canonical.proofDiv.end)}`;
    }
    const before = canonical.source.slice(0, canonical.div.end).replace(/\s*$/, '');
    const after = canonical.source.slice(canonical.div.end).replace(/^\s*/, '');
    return `${before}\n\n${proofText}\n${after ? `\n${after}` : ''}`;
}
export function setProofMarker(source, target, marker = null) {
    if (marker != null && !CONTROL_MARKER_SET.has(marker))
        throw new Error(`Invalid proof marker: ${marker}`);
    const proofDiv = locateProof(source, target);
    if (!proofDiv)
        throw new Error(`Linked proof of @${target.replace(/^@/, '')} was not found`);
    const proofBody = body(source, proofDiv);
    if (!proofBody)
        throw new Error(`Linked proof of @${target.replace(/^@/, '')} has no readable body`);
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.slice(proofBody.bodyStart, proofBody.bodyEnd).split(/\r?\n/);
    const firstContent = lines.findIndex((line) => line.trim() !== '');
    if (firstContent >= 0 && CONTROL_MARKER_SET.has(lines[firstContent].trim()))
        lines.splice(firstContent, 1);
    const content = lines.join(newline).trim();
    const nextBody = marker
        ? `${marker}${content ? `${newline}${newline}${content}` : ''}${newline}`
        : `${content}${content ? newline : ''}`;
    return `${source.slice(0, proofBody.bodyStart)}${nextBody}${source.slice(proofBody.bodyEnd)}`;
}
export function setDefinitionMarker(source, target, marker = null) {
    if (marker != null && !CONTROL_MARKER_SET.has(marker))
        throw new Error(`Invalid definition marker: ${marker}`);
    const id = target.replace(/^@/, '');
    const div = locateDiv(source, id);
    if (!div || !div.attrs.classes.includes('definition'))
        throw new Error(`Definition @${id} was not found`);
    const definitionBody = body(source, div);
    if (!definitionBody)
        throw new Error(`Definition @${id} has no readable body`);
    const raw = source.slice(definitionBody.bodyStart, definitionBody.bodyEnd);
    const normalized = raw.replace(/\r\n/g, '\n');
    const paragraphs = normalized.split(/\n[ \t]*\n/);
    const nonempty = paragraphs.map((paragraph, index) => ({ paragraph: paragraph.trim(), index }))
        .filter((entry) => entry.paragraph !== '');
    const markerParagraphs = nonempty.filter((entry) => CONTROL_MARKER_SET.has(entry.paragraph));
    const last = nonempty.at(-1);
    const trailingMarker = last && CONTROL_MARKER_SET.has(last.paragraph) ? last.paragraph : null;
    if (markerParagraphs.some((entry) => entry.index !== last?.index)) {
        throw new Error(`Definition @${id} has a reserved marker outside its last nonempty paragraph`);
    }
    let construction = raw.replace(/[ \t\r\n]+$/, '');
    if (trailingMarker) {
        const trailing = new RegExp(`(?:^|\\r?\\n[ \\t]*\\r?\\n)[ \\t]*${trailingMarker}[ \\t]*$`);
        const match = trailing.exec(construction);
        if (!match)
            throw new Error(`Definition @${id} has a malformed trailing marker`);
        construction = construction.slice(0, match.index).replace(/[ \t\r\n]+$/, '');
    }
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const nextBody = marker
        ? `${construction}${construction.trim() ? `${newline}${newline}` : ''}${marker}${newline}`
        : `${construction}${construction.trim() ? newline : ''}`;
    return `${source.slice(0, definitionBody.bodyStart)}${nextBody}${source.slice(definitionBody.bodyEnd)}`;
}
export function setFactMarker(source, target, kind, marker = null) {
    return kind === 'definition'
        ? setDefinitionMarker(source, target, marker)
        : setProofMarker(source, target, marker);
}
