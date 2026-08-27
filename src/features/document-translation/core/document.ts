export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
    'pdf',
    'epub',
    'docx',
    'html',
    'htm',
    'txt',
    'md',
    'markdown',
    'srt',
    'vtt',
    'ass',
    'ssa',
    'lrc',
    'json',
] as const;

export type DocumentFormat =
    | 'pdf'
    | 'epub'
    | 'docx'
    | 'html'
    | 'txt'
    | 'markdown'
    | 'srt'
    | 'vtt'
    | 'ass'
    | 'lrc'
    | 'json';

export type DocumentRenderMode = 'bilingual' | 'translated';

export interface DocumentSegment {
    id: number;
    source: string;
    /** Optional reader context, such as a PDF page or ePub chapter. */
    contextLabel?: string;
    /** Native subtitle timeline metadata. */
    timeStart?: string;
    timeEnd?: string;
    /** Native structured-document location, such as $.items[0].label. */
    pathLabel?: string;
    /** Native document role used by page/article previews. */
    role?: 'title' | 'heading' | 'paragraph' | 'list-item' | 'header' | 'footer' | 'note';
}

export interface PdfDocumentBlock {
    segmentIndex: number;
    /** Top-left PDF viewport coordinates at scale 1. */
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    /** Median source line height in PDF viewport units. */
    lineHeight: number;
    /** Number of source text lines represented by this paragraph block. */
    lineCount: number;
    fontFamily: string;
    fontWeight: 400 | 600 | 700;
    textAlign: 'left' | 'center' | 'right';
}

export interface PdfDocumentPage {
    pageNumber: number;
    width: number;
    height: number;
    segmentIndexes: number[];
    blocks: PdfDocumentBlock[];
}

export interface EpubDocumentChapter {
    path: string;
    source: string;
    segmentOffset: number;
    segmentCount: number;
    title: string;
}

export interface DocxDocumentPart {
    path: string;
    source: string;
    paragraphSegments: Array<{paragraphIndex: number; segmentIndex: number}>;
}

export type BinaryDocumentData =
    | {kind: 'pdf'; bytes: Uint8Array; pages: PdfDocumentPage[]}
    | {kind: 'epub'; bytes: Uint8Array; chapters: EpubDocumentChapter[]}
    | {kind: 'docx'; bytes: Uint8Array; parts: DocxDocumentPart[]};

interface LiteralPart {
    kind: 'literal';
    value: string;
    /** Markdown source-line group used to keep protected inline syntax in place. */
    bilingualGroup?: number;
}

interface SegmentPart {
    kind: 'segment';
    segmentIndex: number;
    source: string;
    /** Original encoded HTML text used when the bilingual source is rendered. */
    rawSource?: string;
    prefix: string;
    suffix: string;
    /** Repeat a structural prefix when a bilingual line needs a second cue. */
    bilingualPrefix?: string;
    /** Markdown source-line group used to render one coherent bilingual line. */
    bilingualGroup?: number;
}

type DocumentPart = LiteralPart | SegmentPart;

export interface JsonSegmentEntry {
    path: Array<string | number>;
    segmentIndex: number;
    prefix: string;
    suffix: string;
}

export interface ParsedDocument {
    fileName: string;
    format: DocumentFormat;
    label: string;
    parts: readonly DocumentPart[];
    segments: readonly DocumentSegment[];
    jsonValue?: unknown;
    jsonEntries?: readonly JsonSegmentEntry[];
    binary?: BinaryDocumentData;
}

const FORMAT_LABELS: Record<DocumentFormat, string> = {
    pdf: 'PDF 文件',
    epub: 'ePub 电子书',
    docx: 'DOCX 文档',
    html: 'HTML 文件',
    txt: 'TXT 文件',
    markdown: 'Markdown 文件',
    srt: 'SRT 字幕',
    vtt: 'VTT 字幕',
    ass: 'ASS 字幕',
    lrc: 'LRC 歌词',
    json: 'JSON 文件',
};

const PROTECTED_HTML_TAGS = new Set(['head', 'script', 'style', 'pre', 'code', 'textarea']);
const MARKDOWN_PROTECTED_PATTERN = /(`{1,3}[^`\n]+`{1,3}|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\((?:https?:\/\/|#)[^)]+\)|<https?:\/\/[^>]+>|https?:\/\/[^\s)]+)/gu;
const TIMED_SUBTITLE_PATTERN = /^\s*(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}\s*-->\s*(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}(?:\s+.*)?$/u;
const LRC_TIME_PATTERN = /^(\s*(?:\[[^\]\r\n]+\])+)/u;

function extensionOf(fileName: string): string {
    const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/u);
    return match?.[1] || '';
}

export function getDocumentFormat(fileName: string): DocumentFormat | null {
    const extension = extensionOf(fileName);
    if (extension === 'pdf') return 'pdf';
    if (extension === 'epub') return 'epub';
    if (extension === 'docx') return 'docx';
    if (extension === 'html' || extension === 'htm') return 'html';
    if (extension === 'txt') return 'txt';
    if (extension === 'md' || extension === 'markdown') return 'markdown';
    if (extension === 'srt') return 'srt';
    if (extension === 'vtt') return 'vtt';
    if (extension === 'ass' || extension === 'ssa') return 'ass';
    if (extension === 'lrc') return 'lrc';
    if (extension === 'json') return 'json';
    return null;
}

export function getDocumentAcceptAttribute(): string {
    return SUPPORTED_DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(',');
}

export function getDocumentFormatLabel(format: DocumentFormat): string {
    return FORMAT_LABELS[format];
}

export function getDocumentMimeType(format: DocumentFormat): string {
    if (format === 'pdf') return 'application/pdf';
    if (format === 'epub') return 'application/epub+zip';
    if (format === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (format === 'html') return 'text/html;charset=utf-8';
    if (format === 'json') return 'application/json;charset=utf-8';
    return 'text/plain;charset=utf-8';
}

function trimSource(value: string): {prefix: string; source: string; suffix: string} | null {
    const match = value.match(/^(\s*)([\s\S]*?\S)(\s*)$/u);
    if (!match) return null;
    return {prefix: match[1], source: match[2], suffix: match[3]};
}

type SegmentOptions = Pick<SegmentPart, 'bilingualPrefix' | 'bilingualGroup'>
    & Omit<Partial<DocumentSegment>, 'id' | 'source'>;

function addLiteral(parts: DocumentPart[], value: string, bilingualGroup?: number): void {
    if (!value) return;
    const last = parts[parts.length - 1];
    if (last?.kind === 'literal' && last.bilingualGroup === bilingualGroup) {
        last.value += value;
        return;
    }
    parts.push({kind: 'literal', value, bilingualGroup});
}

function addSegment(
    parts: DocumentPart[],
    segments: DocumentSegment[],
    value: string,
    options: SegmentOptions = {},
    transformSource?: (source: string) => string,
): void {
    const trimmed = trimSource(value);
    if (!trimmed) {
        addLiteral(parts, value, options.bilingualGroup);
        return;
    }

    const segmentIndex = segments.length;
    const {bilingualPrefix, bilingualGroup, ...segmentOptions} = options;
    const source = transformSource ? transformSource(trimmed.source) : trimmed.source;
    segments.push({id: segmentIndex, source, ...segmentOptions});
    parts.push({
        kind: 'segment',
        segmentIndex,
        source,
        ...(source === trimmed.source ? {} : {rawSource: trimmed.source}),
        prefix: trimmed.prefix,
        suffix: trimmed.suffix,
        bilingualPrefix,
        bilingualGroup,
    });
}

function addProtectedText(
    parts: DocumentPart[],
    segments: DocumentSegment[],
    value: string,
    pattern: RegExp,
    options: SegmentOptions = {},
): void {
    pattern.lastIndex = 0;
    let cursor = 0;
    let match = pattern.exec(value);
    while (match) {
        addSegment(parts, segments, value.slice(cursor, match.index), options);
        addLiteral(parts, match[0], options.bilingualGroup);
        cursor = match.index + match[0].length;
        match = pattern.exec(value);
    }
    addSegment(parts, segments, value.slice(cursor), options);
}

function splitWithEndings(value: string): Array<{start: number; end: number; textEnd: number; text: string}> {
    const lines: Array<{start: number; end: number; textEnd: number; text: string}> = [];
    const pattern = /[^\r\n]*(?:\r\n|\n|\r|$)/gu;
    let match = pattern.exec(value);
    while (match) {
        if (match[0] === '' && match.index === value.length) break;
        const raw = match[0];
        const endingLength = raw.endsWith('\r\n') ? 2 : raw.endsWith('\n') || raw.endsWith('\r') ? 1 : 0;
        const start = match.index;
        const end = start + raw.length;
        lines.push({
            start,
            end,
            textEnd: end - endingLength,
            text: raw.slice(0, raw.length - endingLength),
        });
        match = pattern.exec(value);
    }
    return lines;
}

function parseTextDocument(content: string, format: 'txt' | 'markdown'): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    const lines = splitWithEndings(content);
    let inFence = false;

    lines.forEach((line, lineIndex) => {
        const fence = /^\s*(`{3,}|~{3,})/u.test(line.text);
        const horizontalRule = /^\s*(?:[-*_]\s*){3,}$/u.test(line.text);
        if (format === 'markdown' && (fence || inFence || horizontalRule)) {
            addLiteral(parts, content.slice(line.start, line.end));
            if (fence) inFence = !inFence;
            return;
        }

        if (format === 'markdown') {
            addProtectedText(parts, segments, line.text, MARKDOWN_PROTECTED_PATTERN, {
                bilingualGroup: lineIndex,
            });
        } else {
            addSegment(parts, segments, line.text);
        }
        addLiteral(parts, content.slice(line.textEnd, line.end));
    });

    return {parts, segments};
}

const HTML_ENTITY_FALLBACKS: Record<string, string> = {
    amp: '&',
    apos: "'",
    bull: '•',
    cent: '¢',
    copy: '©',
    emsp: ' ',
    ensp: ' ',
    euro: '€',
    gt: '>',
    hellip: '…',
    laquo: '«',
    ldquo: '“',
    lsquo: '‘',
    lt: '<',
    mdash: '—',
    middot: '·',
    ndash: '–',
    nbsp: ' ',
    pound: '£',
    quot: '"',
    raquo: '»',
    rdquo: '”',
    reg: '®',
    rsquo: '’',
    thinsp: ' ',
    trade: '™',
    yen: '¥',
};

function decodeHtmlEntities(value: string): string {
    if (!value.includes('&')) return value;
    if (typeof globalThis.document !== 'undefined') {
        const textarea = globalThis.document.createElement('textarea');
        textarea.innerHTML = value;
        return textarea.value;
    }

    return value.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]+));/giu, (entity, hex, decimal, name) => {
        if (name) return HTML_ENTITY_FALLBACKS[String(name).toLowerCase()] ?? entity;
        const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
        return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : '�';
    });
}

interface HtmlToken {
    index: number;
    value: string;
}

/** Find the next HTML token without treating `>` inside a quoted attribute as the tag boundary. */
function findNextHtmlToken(content: string, from: number): HtmlToken | null {
    let index = content.indexOf('<', from);
    while (index >= 0) {
        const next = content[index + 1];
        if (next && (next === '!' || next === '?' || next === '/' || /[a-z]/iu.test(next))) {
            if (content.startsWith('<!--', index)) {
                const commentEnd = content.indexOf('-->', index + 4);
                const end = commentEnd >= 0 ? commentEnd + 3 : content.length;
                return {index, value: content.slice(index, end)};
            }

            let quote = '';
            for (let cursor = index + 1; cursor < content.length; cursor += 1) {
                const character = content[cursor];
                if (quote) {
                    if (character === quote) quote = '';
                    continue;
                }
                if (character === '"' || character === "'") {
                    quote = character;
                    continue;
                }
                if (character === '>') {
                    return {index, value: content.slice(index, cursor + 1)};
                }
            }
            return null;
        }
        index = content.indexOf('<', index + 1);
    }
    return null;
}

function parseHtmlDocument(content: string): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    let cursor = 0;
    let protectedTag = '';

    let match = findNextHtmlToken(content, 0);
    while (match) {
        const tag = match.value;
        if (!protectedTag) addSegment(parts, segments, content.slice(cursor, match.index), {}, decodeHtmlEntities);
        else addLiteral(parts, content.slice(cursor, match.index));
        addLiteral(parts, tag);

        const closing = tag.match(/^<\s*\/\s*([a-z0-9-]+)/iu)?.[1]?.toLowerCase();
        if (closing && closing === protectedTag) {
            protectedTag = '';
        } else if (!closing && !protectedTag) {
            const opening = tag.match(/^<\s*([a-z0-9-]+)/iu)?.[1]?.toLowerCase();
            if (opening && PROTECTED_HTML_TAGS.has(opening) && !/\/\s*>$/u.test(tag)) {
                protectedTag = opening;
            }
        }

        cursor = match.index + tag.length;
        match = findNextHtmlToken(content, cursor);
    }

    if (cursor < content.length) {
        if (protectedTag) addLiteral(parts, content.slice(cursor));
        else addSegment(parts, segments, content.slice(cursor), {}, decodeHtmlEntities);
    }
    return {parts, segments};
}

function parseTimedSubtitleDocument(content: string, format: 'srt' | 'vtt'): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    const lines = splitWithEndings(content);
    let cursorLine = 0;

    while (cursorLine < lines.length) {
        const timestampLine = lines[cursorLine];
        if (!timestampLine || !TIMED_SUBTITLE_PATTERN.test(timestampLine.text)) {
            addLiteral(parts, content.slice(timestampLine.start, timestampLine.end));
            cursorLine += 1;
            continue;
        }

        const timeMatch = timestampLine.text.match(/^\s*((?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3})/u);
        addLiteral(parts, content.slice(timestampLine.start, timestampLine.end));
        cursorLine += 1;
        const textStartLine = cursorLine;
        while (cursorLine < lines.length && lines[cursorLine].text.trim() && !TIMED_SUBTITLE_PATTERN.test(lines[cursorLine].text)) {
            const nextLineStartsCue = format === 'srt'
                && /^\s*\d+\s*$/u.test(lines[cursorLine].text)
                && TIMED_SUBTITLE_PATTERN.test(lines[cursorLine + 1]?.text || '');
            if (nextLineStartsCue) break;
            cursorLine += 1;
        }

        if (cursorLine === textStartLine) continue;
        const textStart = lines[textStartLine].start;
        const textEnd = lines[cursorLine - 1].textEnd;
        const source = content.slice(textStart, textEnd);
        // Keep a complete cue in one translation unit. This lets the provider
        // preserve inline subtitle tags such as <i>...</i> or ASS override
        // codes while keeping timestamps and cue boundaries outside the request.
        addSegment(parts, segments, source, {
            timeStart: timeMatch?.[1],
            timeEnd: timeMatch?.[2],
        });

        if (cursorLine < lines.length) {
            addLiteral(parts, content.slice(textEnd, lines[cursorLine].start));
        } else {
            addLiteral(parts, content.slice(textEnd));
        }
    }

    return {parts, segments};
}

function parseAssDocument(content: string): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    const lines = splitWithEndings(content);

    lines.forEach((line) => {
        if (!/^\s*Dialogue\s*:/iu.test(line.text)) {
            addLiteral(parts, content.slice(line.start, line.end));
            return;
        }

        const colon = line.text.indexOf(':');
        const prefix = line.text.slice(0, colon + 1);
        const dialogue = line.text.slice(colon + 1);
        let commaCount = 0;
        let textStart = -1;
        for (let index = 0; index < dialogue.length; index += 1) {
            if (dialogue[index] !== ',') continue;
            commaCount += 1;
            if (commaCount === 9) {
                textStart = index + 1;
                break;
            }
        }

        if (textStart < 0) {
            addLiteral(parts, content.slice(line.start, line.end));
            return;
        }

        const fields = dialogue.slice(0, textStart - 1).split(',');
        addLiteral(parts, prefix + dialogue.slice(0, textStart));
        addSegment(parts, segments, dialogue.slice(textStart), {
            timeStart: fields[1]?.trim(),
            timeEnd: fields[2]?.trim(),
        });
        addLiteral(parts, content.slice(line.textEnd, line.end));
    });

    return {parts, segments};
}

function parseLrcDocument(content: string): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    const lines = splitWithEndings(content);

    lines.forEach((line) => {
        const match = line.text.match(LRC_TIME_PATTERN);
        if (!match) {
            addLiteral(parts, content.slice(line.start, line.end));
            return;
        }

        const prefix = match[1];
        addLiteral(parts, prefix);
        const firstTimestamp = prefix.match(/\[((?:\d{1,3}:)?\d{2}(?:\.\d{1,3})?)\]/u)?.[1];
        addSegment(parts, segments, line.text.slice(prefix.length), {
            bilingualPrefix: prefix,
            timeStart: firstTimestamp,
        });
        addLiteral(parts, content.slice(line.textEnd, line.end));
    });

    return {parts, segments};
}

function cloneJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneJsonValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
    }
    return value;
}

function parseJsonDocument(content: string): Pick<ParsedDocument, 'segments' | 'jsonValue' | 'jsonEntries'> {
    let jsonValue: unknown;
    try {
        jsonValue = JSON.parse(content);
    } catch (error) {
        // JSON.parse 按规范只会抛 SyntaxError；统一字符串化后移除类型前缀，避免不可达的错误类型分支。
        const message = String(error).replace(/^SyntaxError:\s*/u, '');
        throw new Error(`JSON 文件格式无效：${message}`);
    }

    const segments: DocumentSegment[] = [];
    const jsonEntries: JsonSegmentEntry[] = [];
    const walk = (value: unknown, path: Array<string | number>) => {
        if (typeof value === 'string') {
            const trimmed = trimSource(value);
            if (!trimmed) return;
            const segmentIndex = segments.length;
            const pathLabel = formatJsonPath(path);
            segments.push({id: segmentIndex, source: trimmed.source, pathLabel});
            jsonEntries.push({path: [...path], segmentIndex, prefix: trimmed.prefix, suffix: trimmed.suffix});
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, [...path, index]));
            return;
        }
        if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, item]) => walk(item, [...path, key]));
        }
    };
    walk(jsonValue, []);
    return {segments, jsonValue, jsonEntries};
}

export function formatJsonPath(path: Array<string | number>): string {
    return path.reduce<string>((value, part) => {
        if (typeof part === 'number') return `${value}[${part}]`;
        return /^[A-Za-z_$][\w$]*$/u.test(part)
            ? `${value}.${part}`
            : `${value}[${JSON.stringify(part)}]`;
    }, '$');
}

export function parseDocument(fileName: string, content: string): ParsedDocument {
    const format = getDocumentFormat(fileName);
    if (!format) {
        throw new Error('暂不支持该文件格式，请选择 PDF、ePub、HTML、JSON、TXT、DOCX、Markdown 或字幕文件');
    }
    if (format === 'pdf' || format === 'epub' || format === 'docx') {
        throw new Error(`${getDocumentFormatLabel(format)}需要按二进制文件解析，请重新打开该文件`);
    }

    if (format === 'json') {
        return {
            fileName,
            format,
            label: getDocumentFormatLabel(format),
            parts: [],
            ...parseJsonDocument(content),
        };
    }

    const parsed = format === 'html'
        ? parseHtmlDocument(content)
        : format === 'txt' || format === 'markdown'
            ? parseTextDocument(content, format)
            : format === 'ass'
                ? parseAssDocument(content)
                : format === 'lrc'
                    ? parseLrcDocument(content)
                    : parseTimedSubtitleDocument(content, format);

    return {fileName, format, label: getDocumentFormatLabel(format), ...parsed};
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function preserveSubtitleMarkup(source: string, translation: string): string {
    if (!translation.trim()) return translation;

    const assPrefix = source.match(/^(?:\{[^}]*\})+/u)?.[0];
    if (assPrefix && !translation.startsWith(assPrefix)) return `${assPrefix}${translation}`;

    const htmlOpen = source.match(/^(?:<([a-z][a-z0-9-]*)\b[^>]*>)+/iu)?.[0];
    const htmlClose = source.match(/(?:<\/([a-z][a-z0-9-]*)>)+(?=\s|$)/iu)?.[0];
    if (htmlOpen && htmlClose && !translation.includes(htmlOpen)) {
        return `${htmlOpen}${translation}${htmlClose}`;
    }
    return translation;
}

function originalPartSource(part: SegmentPart): string {
    return part.rawSource ?? part.source;
}

function formatBilingualTranslation(document: ParsedDocument, part: SegmentPart, translation: string): string {
    const source = originalPartSource(part);
    const formattedTranslation = ['srt', 'vtt', 'ass'].includes(document.format)
        ? preserveSubtitleMarkup(part.source, translation)
        : translation;
    if (document.format === 'html') {
        return `${part.prefix}${source}${part.suffix}<br><span data-fluent-read-document-translation="true">${escapeHtml(translation)}</span>`;
    }
    if (document.format === 'markdown') {
        return `${part.prefix}${source}${part.suffix}\n> ${translation}`;
    }
    if (document.format === 'ass') {
        return `${part.prefix}${source}${part.suffix}\\N${formattedTranslation.replace(/\r?\n/gu, '\\N')}`;
    }
    if (part.bilingualPrefix) {
        return `${part.prefix}${source}${part.suffix}\n${part.bilingualPrefix}${formattedTranslation}`;
    }
    return `${part.prefix}${source}${part.suffix}\n${formattedTranslation}`;
}

function renderParts(document: ParsedDocument, translations: readonly string[], mode: DocumentRenderMode): string {
    const output: string[] = [];
    for (let index = 0; index < document.parts.length; index += 1) {
        const part = document.parts[index];
        if (mode === 'bilingual' && document.format === 'markdown' && part.bilingualGroup !== undefined) {
            const group = part.bilingualGroup;
            const groupParts: DocumentPart[] = [];
            while (index < document.parts.length && document.parts[index].bilingualGroup === group) {
                groupParts.push(document.parts[index]);
                index += 1;
            }
            index -= 1;
            const source = groupParts.map((entry) => entry.kind === 'literal'
                ? entry.value
                : `${entry.prefix}${originalPartSource(entry)}${entry.suffix}`).join('');
            if (!groupParts.some((entry) => entry.kind === 'segment')) {
                output.push(source);
                continue;
            }
            const translated = groupParts.map((entry) => {
                if (entry.kind === 'literal') return entry.value;
                return `${entry.prefix}${translations[entry.segmentIndex] ?? entry.source}${entry.suffix}`;
            }).join('').replace(/\r\n?|\n/gu, '\n> ');
            output.push(`${source}\n> ${translated}`);
            continue;
        }
        if (part.kind === 'literal') {
            output.push(part.value);
            continue;
        }
        const translation = translations[part.segmentIndex] ?? part.source;
        if (mode === 'bilingual') {
            output.push(formatBilingualTranslation(document, part, translation));
            continue;
        }
        if (document.format === 'html') {
            output.push(`${part.prefix}${escapeHtml(translation)}${part.suffix}`);
            continue;
        }
        const formattedTranslation = ['srt', 'vtt', 'ass'].includes(document.format)
            ? preserveSubtitleMarkup(part.source, translation)
            : translation;
        output.push(`${part.prefix}${formattedTranslation}${part.suffix}`);
    }
    return output.join('');
}

function getAtPath(value: unknown, path: Array<string | number>): unknown {
    let current = value;
    for (const key of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string | number, unknown>)[key];
    }
    return current;
}

function setAtPath(root: unknown, path: Array<string | number>, value: unknown): unknown {
    if (path.length === 0) return value;
    let current = root as Record<string | number, unknown>;
    path.slice(0, -1).forEach((key) => {
        current = current[key] as Record<string | number, unknown>;
    });
    current[path[path.length - 1]] = value;
    return root;
}

export function renderDocument(
    document: ParsedDocument,
    translations: readonly string[],
    mode: DocumentRenderMode = 'bilingual',
): string {
    if (document.format !== 'json') return renderParts(document, translations, mode);

    let output = cloneJsonValue(document.jsonValue);
    document.jsonEntries?.forEach((entry) => {
        const original = getAtPath(output, entry.path);
        if (typeof original !== 'string') return;
        const translation = translations[entry.segmentIndex] ?? original.trim();
        const value = mode === 'bilingual'
            ? `${entry.prefix}${original.trim()}\n${translation}${entry.suffix}`
            : `${entry.prefix}${translation}${entry.suffix}`;
        output = setAtPath(output, entry.path, value);
    });
    return JSON.stringify(output, null, 2);
}

export function createDocumentDownloadName(fileName: string, mode: DocumentRenderMode): string {
    const suffix = mode === 'bilingual' ? '.bilingual' : '.translated';
    // 正则始终匹配完整字符串；用非空断言表达该不变量，避免把不可达分支伪装成容错。
    const match = fileName.match(/^(.*?)(\.[^.]+)?$/u)!;
    return `${match[1] || fileName}${suffix}${match[2] || ''}`;
}
