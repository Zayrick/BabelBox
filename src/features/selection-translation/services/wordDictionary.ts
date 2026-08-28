/**
 * 单词学习卡片的数据适配层。
 *
 * 这里不把大型词典打进扩展包，而是调用公开的结构化词典服务，并把
 * 不同服务的响应归一化为同一份小数据结构。服务不可用时按顺序尝试
 * 中国境内优先的公共词典接口，以及 Free Dictionary API、Datamuse、
 * Wiktionary REST 和 WiktApi；这样单个免费服务的区域限制、限流或维护不会
 * 直接让划词卡片失效。
 */

import {readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';

export type WordDictionaryProviderId = 'ecdict-local' | 'youdao-web' | 'free-dictionary' | 'wiktapi' | 'wiktionary-rest' | 'datamuse';

export interface WordPronunciation {
    text?: string;
    audio?: string;
    label?: string;
}

export interface WordDefinition {
    definition: string;
    example?: string;
    translatedDefinition?: string;
    translatedExample?: string;
}

export interface WordMeaning {
    partOfSpeech: string;
    definitions: WordDefinition[];
}

export interface WordDictionarySource {
    id: WordDictionaryProviderId;
    label: string;
    url: string;
}

export interface WordCardData {
    word: string;
    normalizedWord: string;
    phonetics: WordPronunciation[];
    meanings: WordMeaning[];
    origin?: string;
    sources: WordDictionarySource[];
}

interface FreeDictionaryEntry {
    word?: unknown;
    phonetic?: unknown;
    phonetics?: unknown;
    origin?: unknown;
    meanings?: unknown;
    sourceUrls?: unknown;
}

interface WiktApiEntry {
    word?: unknown;
    lang_code?: unknown;
    pos?: unknown;
    senses?: unknown;
    sounds?: unknown;
}

interface WiktApiResponse {
    word?: unknown;
    entries?: unknown;
}

interface DatamuseWord {
    word?: unknown;
    tags?: unknown;
    defs?: unknown;
}

interface YoudaoWord {
    usphone?: unknown;
    ukphone?: unknown;
    usspeech?: unknown;
    ukspeech?: unknown;
    trs?: unknown;
}

interface YoudaoSimpleWord extends YoudaoWord {
    multiPhone?: {
        uk?: unknown;
        us?: unknown;
    };
}

interface YoudaoResponse {
    ec?: {
        word?: YoudaoWord;
    };
    simple?: unknown;
}

interface YoudaoTranslation {
    pos?: unknown;
    tran?: unknown;
}

interface EcdictEntry {
    w?: unknown;
    p?: unknown;
    d?: unknown;
    t?: unknown;
    pos?: unknown;
}

interface WiktionaryDefinitionEntry {
    partOfSpeech?: unknown;
    language?: unknown;
    definitions?: unknown;
}

const MAX_WORD_LENGTH = 64;
const LOOKUP_TIMEOUT_MS = 4_000;
const CHINA_PROVIDER_TIMEOUT_MS = 1_800;
const WIKTAPI_TIMEOUT_MS = 1_200;
const MAX_DEFINITIONS_PER_MEANING = 6;
const MAX_MEANINGS = 6;

const SOURCE_INFO: Record<WordDictionaryProviderId, WordDictionarySource> = {
    'ecdict-local': {
        id: 'ecdict-local',
        label: 'ECDICT 本地词库',
        url: 'https://github.com/skywind3000/ECDICT',
    },
    'youdao-web': {
        id: 'youdao-web',
        label: '有道词典',
        url: 'https://dict.youdao.com/',
    },
    'free-dictionary': {
        id: 'free-dictionary',
        label: 'Free Dictionary API',
        url: 'https://dictionaryapi.dev/',
    },
    wiktapi: {
        id: 'wiktapi',
        label: 'WiktApi / Wiktionary',
        url: 'https://wiktapi.dev/',
    },
    'wiktionary-rest': {
        id: 'wiktionary-rest',
        label: 'Wiktionary',
        url: 'https://en.wiktionary.org/',
    },
    datamuse: {
        id: 'datamuse',
        label: 'Datamuse',
        url: 'https://www.datamuse.com/api/',
    },
};

/**
 * 把网页中常见的排版引号/连字符折叠为词典协议可接受的 ASCII 形式。
 * 其余 Unicode 字符仍会被拒绝，避免把同形异义字符或零宽字符发送给第三方服务。
 */
export function normalizeEnglishWord(value: string): string | null {
    const normalized = String(value || '')
        .trim()
        .normalize('NFC')
        .replace(/[‘’ʼ]/gu, "'")
        .replace(/[‐‑‒–—]/gu, '-');
    if (normalized.length === 0 || normalized.length > MAX_WORD_LENGTH) return null;
    if (!/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/u.test(normalized)) return null;
    return normalized.toLowerCase();
}

export function isSingleEnglishWord(value: string): boolean {
    return normalizeEnglishWord(value) !== null;
}

function textValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function safeHttpUrl(value: unknown): string | undefined {
    const candidate = textValue(value);
    if (!candidate) return undefined;
    try {
        const url = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate);
        if (url.protocol !== 'https:' || url.username || url.password) return undefined;
        return url.toString();
    } catch {
        return undefined;
    }
}

function stripHtml(value: unknown): string {
    const raw = textValue(value);
    if (!raw) return '';
    return raw
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizePartOfSpeech(value: unknown): string {
    const valueText = textValue(value);
    if (!valueText) return '其他';
    const normalized = valueText.toLowerCase().replace(/\.$/u, '');
    const labels: Record<string, string> = {
        adj: '形容词',
        adjective: '形容词',
        adv: '副词',
        adverb: '副词',
        article: '冠词',
        a: '形容词',
        aux: '助动词',
        conjunction: '连词',
        conj: '连词',
        dat: '代词',
        determiner: '限定词',
        int: '感叹词',
        interjection: '感叹词',
        intj: '感叹词',
        noun: '名词',
        n: '名词',
        obj: '代词',
        preposition: '介词',
        prep: '介词',
        pronoun: '代词',
        pron: '代词',
        vi: '动词',
        vt: '动词',
        verb: '动词',
        v: '动词',
    };
    return labels[normalized] || valueText;
}

function createPartialCard(normalizedWord: string, source: WordDictionarySource): WordCardData {
    return {
        word: normalizedWord,
        normalizedWord,
        phonetics: [],
        meanings: [],
        sources: [source],
    };
}

function addSource(card: WordCardData, source: WordDictionarySource): void {
    if (!card.sources.some(item => item.id === source.id)) card.sources.push(source);
}

function addMeaning(card: WordCardData, partOfSpeech: unknown, definitions: WordDefinition[]): void {
    const cleanDefinitions = definitions
        .map(definition => {
            const definitionText = stripHtml(definition.definition);
            const example = stripHtml(definition.example);
            const translatedDefinition = stripHtml(definition.translatedDefinition);
            const translatedExample = stripHtml(definition.translatedExample);
            return {
                definition: definitionText,
                ...(example ? { example } : {}),
                ...(translatedDefinition ? { translatedDefinition } : {}),
                ...(translatedExample ? { translatedExample } : {}),
            };
        })
        .filter(definition => definition.definition)
        .slice(0, MAX_DEFINITIONS_PER_MEANING);
    if (cleanDefinitions.length === 0) return;

    const label = normalizePartOfSpeech(partOfSpeech);
    const existing = card.meanings.find(meaning => meaning.partOfSpeech === label);
    if (existing) {
        const seen = new Set(existing.definitions.map(definition => definition.definition.toLocaleLowerCase()));
        for (const definition of cleanDefinitions) {
            const definitionKey = definition.definition.toLocaleLowerCase();
            const exact = existing.definitions.find(item => item.definition.toLocaleLowerCase() === definitionKey);
            if (exact) {
                if (!exact.translatedDefinition && definition.translatedDefinition) exact.translatedDefinition = definition.translatedDefinition;
                if (!exact.translatedExample && definition.translatedExample) exact.translatedExample = definition.translatedExample;
                if (!exact.example && definition.example) exact.example = definition.example;
                continue;
            }

            // 中国区优先 provider 可能先返回中文释义；后续英文 provider 到达时，
            // 将两者配成同一行，避免卡片展示重复释义。
            const translationOnly = existing.definitions.find(item => !hasEnglishDefinition(item) && item.definition !== definition.definition);
            if (translationOnly && hasEnglishDefinition(definition)) {
                translationOnly.definition = definition.definition;
                if (definition.example) translationOnly.example = definition.example;
                if (definition.translatedExample) translationOnly.translatedExample = definition.translatedExample;
                seen.add(definitionKey);
                continue;
            }

            // 后到的中文释义应附加到已有英文 sense，而不是新增中文-only 重复行。
            if (!hasEnglishDefinition(definition)) {
                const englishDefinition = existing.definitions.find(item => hasEnglishDefinition(item));
                if (englishDefinition) {
                    if (!englishDefinition.translatedDefinition) {
                        englishDefinition.translatedDefinition = definition.definition;
                    } else if (!englishDefinition.translatedDefinition.includes(definition.definition)) {
                        englishDefinition.translatedDefinition += `；${definition.definition}`;
                    }
                    continue;
                }
            }

            if (!seen.has(definitionKey) && existing.definitions.length < MAX_DEFINITIONS_PER_MEANING) {
                existing.definitions.push(definition);
                seen.add(definitionKey);
            }
        }
        return;
    }

    if (card.meanings.length < MAX_MEANINGS) card.meanings.push({ partOfSpeech: label, definitions: cleanDefinitions });
}

function addPronunciation(card: WordCardData, pronunciation: WordPronunciation): void {
    const text = textValue(pronunciation.text);
    const audio = safeHttpUrl(pronunciation.audio);
    if (!text && !audio) return;
    const existing = card.phonetics.find(item => {
        const sameValue = text
            ? textValue(item.text).toLocaleLowerCase() === text.toLocaleLowerCase()
            : safeHttpUrl(item.audio) === audio;
        if (!sameValue) return false;
        // 同一 IPA 可能同时属于美式与英式；标签不同的两行都要保留。
        return !(item.label && pronunciation.label && item.label !== pronunciation.label);
    });
    if (existing) {
        if (!existing.audio && audio) existing.audio = audio;
        if (!existing.label && pronunciation.label) existing.label = pronunciation.label;
        return;
    }
    card.phonetics.push({
        ...(text ? { text } : {}),
        ...(audio ? { audio } : {}),
        ...(pronunciation.label ? { label: pronunciation.label } : {}),
    });
}

function addPronunciations(card: WordCardData, pronunciations: WordPronunciation[]): void {
    for (const pronunciation of pronunciations.slice(0, 8)) addPronunciation(card, pronunciation);
}

function pronunciationRegion(pronunciation: WordPronunciation): '美式' | '英式' | null {
    if (pronunciation.label === '美式' || pronunciation.label === '英式') return pronunciation.label;
    return null;
}

function pronunciationScore(pronunciation: WordPronunciation): number {
    const metadata = `${pronunciation.audio || ''} ${pronunciation.text || ''}`.toLowerCase();
    let score = pronunciation.audio ? 2 : 0;
    if (/stressed|primary|strong/.test(metadata)) score += 4;
    if (/unstressed|weak/.test(metadata)) score -= 2;
    if (pronunciation.text?.includes('ˈ')) score += 1;
    return score;
}

/** 每个地区只保留评分最高的主发音，避免把 provider 的所有弱读变体堆到卡片中。 */
export function selectPronunciations(pronunciations: WordPronunciation[]): WordPronunciation[] {
    const regional = new Map<'美式' | '英式', WordPronunciation>();
    const unlabelled: WordPronunciation[] = [];

    for (const pronunciation of pronunciations) {
        const region = pronunciationRegion(pronunciation);
        if (!region) {
            unlabelled.push(pronunciation);
            continue;
        }
        const current = regional.get(region);
        if (!current || pronunciationScore(pronunciation) > pronunciationScore(current)) regional.set(region, pronunciation);
    }

    if (regional.size > 0) {
        return (['美式', '英式'] as const).flatMap(region => {
            const pronunciation = regional.get(region);
            return pronunciation ? [pronunciation] : [];
        });
    }

    return unlabelled.slice(0, 2);
}

function hasUsefulData(card: WordCardData | null): card is WordCardData {
    return Boolean(card && (card.meanings.length > 0 || card.phonetics.length > 0));
}

function hasEnglishDefinition(card: WordCardData | WordDefinition): boolean {
    if ('definition' in card) return /[A-Za-z]/u.test(card.definition);
    return card.meanings.some(meaning => meaning.definitions.some(definition => hasEnglishDefinition(definition)));
}

function hasNonLocalBackup(card: WordCardData): boolean {
    return card.sources.some(source => source.id !== 'ecdict-local');
}

export function mergeWordCardData(base: WordCardData | null, addition: WordCardData): WordCardData {
    const card = base || createPartialCard(addition.normalizedWord, addition.sources[0] || SOURCE_INFO['free-dictionary']);
    card.word = card.word || addition.word;
    card.normalizedWord = addition.normalizedWord || card.normalizedWord;
    if (!card.origin && addition.origin) card.origin = addition.origin;
    addPronunciations(card, addition.phonetics);
    for (const meaning of addition.meanings) addMeaning(card, meaning.partOfSpeech, meaning.definitions);
    for (const source of addition.sources) addSource(card, source);
    return card;
}

function sourceWithWord(source: WordDictionarySource, normalizedWord: string): WordDictionarySource {
    const sourceUrl = source.id === 'wiktionary-rest'
        ? `https://en.wiktionary.org/wiki/${encodeURIComponent(normalizedWord)}`
        : source.id === 'youdao-web'
            ? `https://dict.youdao.com/result?word=${encodeURIComponent(normalizedWord)}&lang=en`
            : source.url;
    return { ...source, url: sourceUrl };
}

function youdaoAudioUrl(word: string, type: 1 | 2): string {
    return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
}

function firstPronunciation(value: unknown): string {
    return textValue(value).split(/[;；]/u, 1)[0].trim();
}

function chooseYoudaoVariant(value: unknown): { text: string; audio?: string } | null {
    const variants = Array.isArray(value) ? value : [];
    const candidates = variants.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const variant = item as Record<string, unknown>;
        const text = firstPronunciation(variant.phone);
        if (!text) return [];
        const speech = textValue(variant.speech);
        const score = (text.includes('ː') ? 2 : 0) + (text.includes('ˈ') ? 1 : 0) - (/[əɪʊ]$/u.test(text) ? 1 : 0);
        return [{ text, speech, score }];
    });
    const selected = candidates.sort((left, right) => right.score - left.score)[0];
    if (!selected) return null;
    return {
        text: selected.text,
        ...(selected.speech ? { audio: `https://dict.youdao.com/dictvoice?${selected.speech}` } : {}),
    };
}

function localDictionaryUrl(): string | null {
    try {
        const extensionGlobal = globalThis as typeof globalThis & {
            browser?: { runtime?: { getURL?: (path: string) => string } };
            chrome?: { runtime?: { getURL?: (path: string) => string } };
        };
        const runtime = extensionGlobal.browser?.runtime || extensionGlobal.chrome?.runtime;
        return typeof runtime?.getURL === 'function' ? runtime.getURL('ecdict-core.json') : null;
    } catch {
        return null;
    }
}

function normalizeEcdictText(value: unknown): string {
    return stripHtml(textValue(value).replace(/\\n/gu, ' '));
}

function normalizeEcdictPartOfSpeech(value: unknown): string {
    const first = textValue(value).split(/[&/]/u)[0]?.trim();
    return normalizePartOfSpeech(first || '其他');
}

interface EcdictLine {
    partOfSpeech: string;
    text: string;
}

function parseEcdictLines(value: unknown, fallbackPartOfSpeech = '其他'): EcdictLine[] {
    let currentPartOfSpeech = fallbackPartOfSpeech;
    return textValue(value)
        .split(/\\n|\r?\n/u)
        .map(normalizeEcdictText)
        .filter(Boolean)
        .map(line => {
            const match = line.match(/^([A-Za-z]{1,8}\.(?:\s*&\s*[A-Za-z]{1,8}\.)*)\s+(.+)$/u);
            if (!match) return { partOfSpeech: currentPartOfSpeech, text: line };
            currentPartOfSpeech = normalizeEcdictPartOfSpeech(match[1]);
            return {
                partOfSpeech: currentPartOfSpeech,
                text: match[2].trim(),
            };
        });
}

/** Parse one compact local ECDICT row into the shared learning-card shape. */
export function parseEcdictEntry(entry: EcdictEntry, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO['ecdict-local'], normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    const word = textValue(entry.w);
    const phonetic = normalizeEcdictText(entry.p);
    if (word) card.word = word;
    if (phonetic) addPronunciation(card, { text: `/${phonetic}/` });

    const fallbackPartOfSpeech = normalizeEcdictPartOfSpeech(entry.pos);
    const definitions = parseEcdictLines(entry.d, fallbackPartOfSpeech);
    const translations = parseEcdictLines(entry.t);
    const usedTranslations = new Set<number>();
    for (const [definitionIndex, definition] of definitions.entries()) {
        const translationIndex = translations.findIndex((translation, index) => (
            !usedTranslations.has(index) && translation.partOfSpeech === definition.partOfSpeech
        ));
        const futurePartOfSpeech = new Set(
            definitions.slice(definitionIndex + 1).map((item) => item.partOfSpeech),
        );
        const fallbackTranslationIndex = translationIndex >= 0
            ? translationIndex
            : translations.findIndex((translation, index) => (
                !usedTranslations.has(index) && !futurePartOfSpeech.has(translation.partOfSpeech)
            ));
        if (fallbackTranslationIndex >= 0) usedTranslations.add(fallbackTranslationIndex);
        addMeaning(card, definition.partOfSpeech, [{
            definition: definition.text,
            ...(fallbackTranslationIndex >= 0 ? { translatedDefinition: translations[fallbackTranslationIndex].text } : {}),
        }]);
    }
    return card;
}

/** Parse the no-key public dictionary payload used by the Chinese-region-first fallback. */
export function parseYoudaoResponse(payload: unknown, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO['youdao-web'], normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    if (!payload || typeof payload !== 'object') return card;
    const response = payload as YoudaoResponse;
    const word = response.ec?.word;
    if (!word || typeof word !== 'object') return card;

    const usphone = textValue(word.usphone);
    if (usphone) addPronunciation(card, { text: `/${firstPronunciation(usphone)}/`, audio: youdaoAudioUrl(normalizedWord, 2), label: '美式' });

    const simpleValue = response.simple;
    const simpleWords = Array.isArray(simpleValue)
        ? simpleValue
        : simpleValue && typeof simpleValue === 'object' && Array.isArray((simpleValue as { word?: unknown }).word)
            ? (simpleValue as { word: unknown[] }).word
            : [];
    const simpleWord = simpleWords.find(item => item && typeof item === 'object') as YoudaoSimpleWord | undefined;
    const multiPhoneUk = chooseYoudaoVariant(simpleWord?.multiPhone?.uk);
    const ukphone = multiPhoneUk?.text || firstPronunciation(word.ukphone);
    if (ukphone) {
        addPronunciation(card, {
            text: `/${ukphone}/`,
            audio: multiPhoneUk?.audio || youdaoAudioUrl(normalizedWord, 1),
            label: '英式',
        });
    }

    const translations = Array.isArray(word.trs) ? word.trs : [];
    for (const translation of translations) {
        if (!translation || typeof translation !== 'object') continue;
        const item = translation as YoudaoTranslation;
        const translatedDefinition = stripHtml(item.tran);
        if (!translatedDefinition) continue;
        addMeaning(card, item.pos, [{ definition: translatedDefinition, translatedDefinition }]);
    }
    return card;
}

export function parseFreeDictionaryEntry(entry: FreeDictionaryEntry, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO['free-dictionary'], normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    const entryWord = textValue(entry.word);
    if (entryWord) card.word = entryWord;

    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
    addPronunciations(card, phonetics.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const value = item as Record<string, unknown>;
        const audio = safeHttpUrl(value.audio);
        const text = textValue(value.text);
        if (!text && !audio) return [];
        const label = audio?.toLowerCase().includes('-uk') ? '英式' : audio?.toLowerCase().includes('-us') ? '美式' : undefined;
        return [{ text, audio, label }];
    }));
    const phonetic = textValue(entry.phonetic);
    if (phonetic) addPronunciation(card, { text: phonetic });

    const meanings = Array.isArray(entry.meanings) ? entry.meanings : [];
    for (const meaning of meanings) {
        if (!meaning || typeof meaning !== 'object') continue;
        const value = meaning as Record<string, unknown>;
        const definitions = Array.isArray(value.definitions) ? value.definitions : [];
        addMeaning(card, value.partOfSpeech, definitions.flatMap(definition => {
            if (!definition || typeof definition !== 'object') return [];
            const item = definition as Record<string, unknown>;
            return [{ definition: textValue(item.definition), example: textValue(item.example) }];
        }));
    }
    const origin = stripHtml(entry.origin);
    if (origin) card.origin = origin;
    return card;
}

export function parseWiktApiEntry(entry: WiktApiEntry, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO.wiktapi, normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    const entryWord = textValue(entry.word);
    if (entryWord) card.word = entryWord;

    const senses = Array.isArray(entry.senses) ? entry.senses : [];
    for (const sense of senses) {
        if (!sense || typeof sense !== 'object') continue;
        const value = sense as Record<string, unknown>;
        const glosses = Array.isArray(value.glosses) ? value.glosses.map(textValue) : [];
        const examples = Array.isArray(value.examples) ? value.examples : [];
        const example = examples.find(item => item && typeof item === 'object' && textValue((item as Record<string, unknown>).text));
        addMeaning(card, entry.pos, glosses.map(definition => ({
            definition,
            example: example && typeof example === 'object' ? textValue((example as Record<string, unknown>).text) : undefined,
        })));
    }

    const sounds = Array.isArray(entry.sounds) ? entry.sounds : [];
    addPronunciations(card, sounds.flatMap(sound => {
        if (!sound || typeof sound !== 'object') return [];
        const value = sound as Record<string, unknown>;
        const text = textValue(value.ipa) || textValue(value.enpr);
        const audio = safeHttpUrl(value.mp3_url) || safeHttpUrl(value.ogg_url) || safeHttpUrl(value.audio);
        const tags = Array.isArray(value.tags) ? value.tags.map(textValue).join(' ') : '';
        const label = /received-pronunciation|british|uk/i.test(tags) ? '英式' : /general-american|american|us/i.test(tags) ? '美式' : undefined;
        return [{ text, audio, label }];
    }));
    return card;
}

export function parseDatamuseWord(entry: DatamuseWord, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO.datamuse, normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    if (textValue(entry.word).toLowerCase() !== normalizedWord) return card;

    const tags = Array.isArray(entry.tags) ? entry.tags.map(textValue) : [];
    const pronunciation = tags.find(tag => tag.toLowerCase().startsWith('pron:'))?.slice(5).trim();
    if (pronunciation) addPronunciation(card, { text: pronunciation });
    const definitions = Array.isArray(entry.defs) ? entry.defs : [];
    const definitionsByPartOfSpeech = new Map<string, WordDefinition[]>();
    for (const item of definitions) {
        const value = textValue(item);
        if (!value) continue;
        const separator = value.indexOf('\t');
        const partOfSpeech = separator >= 0 ? value.slice(0, separator) : '其他';
        const definition = separator >= 0 ? value.slice(separator + 1) : value;
        const list = definitionsByPartOfSpeech.get(partOfSpeech) || [];
        list.push({ definition });
        definitionsByPartOfSpeech.set(partOfSpeech, list);
    }
    for (const [partOfSpeech, definitionsForPart] of definitionsByPartOfSpeech) addMeaning(card, partOfSpeech, definitionsForPart);
    return card;
}

function parseWiktionaryRestEntry(entry: WiktionaryDefinitionEntry, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO['wiktionary-rest'], normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    const definitions = Array.isArray(entry.definitions) ? entry.definitions : [];
    for (const definition of definitions) {
        if (!definition || typeof definition !== 'object') continue;
        const value = definition as Record<string, unknown>;
        const text = stripHtml(value.definition);
        const examples = Array.isArray(value.examples) ? value.examples : [];
        const example = examples.find(item => item && typeof item === 'object' && stripHtml((item as Record<string, unknown>).example));
        addMeaning(card, entry.partOfSpeech, [{
            definition: text,
            example: example && typeof example === 'object' ? stripHtml((example as Record<string, unknown>).example) : undefined,
        }]);
    }
    return card;
}

async function fetchJson(url: string, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await runtimeFetch(url, {
            credentials: 'omit',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`dictionary request failed: ${response.status}`);
        return await readJsonResponse(response, 'dictionary response is not valid JSON');
    } finally {
        clearTimeout(timer);
    }
}

export interface WordDictionaryProvider {
    readonly id: WordDictionaryProviderId;
    readonly lookup: (word: string) => Promise<WordCardData | null>;
}

function createEcdictProvider(): WordDictionaryProvider {
    let indexPromise: Promise<Map<string, EcdictEntry>> | null = null;

    const loadIndex = async (): Promise<Map<string, EcdictEntry>> => {
        if (indexPromise) return indexPromise;
        const url = localDictionaryUrl();
        if (!url) return new Map();

        // 同一后台生命周期只解析一次本地词库；若读取失败则清掉失败 Promise，
        // 让浏览器资源短暂不可用后的下一次查询能够自动恢复。
        indexPromise = (async () => {
            const response = await runtimeFetch(url, {credentials: 'omit'});
            if (!response.ok) throw new Error(`local dictionary request failed: ${response.status}`);
            const payload = await readJsonResponse(response, 'local dictionary response is not valid JSON');
            const entries = Array.isArray(payload) ? payload : [];
            return new Map(entries.flatMap((entry) => {
                if (!entry || typeof entry !== 'object') return [];
                const item = entry as EcdictEntry;
                const word = textValue(item.w).toLowerCase();
                return word ? [[word, item] as const] : [];
            }));
        })();
        try {
            return await indexPromise;
        } catch (error) {
            indexPromise = null;
            throw error;
        }
    };

    return {
        id: 'ecdict-local',
        async lookup(normalizedWord) {
            const entry = (await loadIndex()).get(normalizedWord);
            return entry ? parseEcdictEntry(entry, normalizedWord) : null;
        },
    };
}

async function lookupFreeDictionary(normalizedWord: string): Promise<WordCardData | null> {
    const payload = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalizedWord)}`);
    if (!Array.isArray(payload)) return null;
    return payload.reduce<WordCardData | null>((card, entry) => {
        if (!entry || typeof entry !== 'object') return card;
        return mergeWordCardData(card, parseFreeDictionaryEntry(entry as FreeDictionaryEntry, normalizedWord));
    }, null);
}

async function lookupYoudao(normalizedWord: string): Promise<WordCardData | null> {
    const url = `https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4&q=${encodeURIComponent(normalizedWord)}&le=eng`;
    const payload = await fetchJson(url, CHINA_PROVIDER_TIMEOUT_MS);
    const card = parseYoudaoResponse(payload, normalizedWord);
    return hasUsefulData(card) ? card : null;
}

async function lookupWiktApi(normalizedWord: string): Promise<WordCardData | null> {
    const payload = await fetchJson(`https://api.wiktapi.dev/v1/en/word/${encodeURIComponent(normalizedWord)}`, WIKTAPI_TIMEOUT_MS);
    if (!payload || typeof payload !== 'object') return null;
    const rawEntries = (payload as WiktApiResponse).entries;
    const entries: unknown[] = Array.isArray(rawEntries) ? rawEntries : [];
    return entries.reduce<WordCardData | null>((card, entry) => {
        if (!entry || typeof entry !== 'object') return card;
        const item = entry as WiktApiEntry;
        if (textValue(item.lang_code) && textValue(item.lang_code) !== 'en') return card;
        return mergeWordCardData(card, parseWiktApiEntry(item, normalizedWord));
    }, null);
}

async function lookupWiktionaryRest(normalizedWord: string): Promise<WordCardData | null> {
    const payload = await fetchJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(normalizedWord)}`);
    if (!payload || typeof payload !== 'object') return null;
    const rawEnglishEntries = (payload as Record<string, unknown>).en;
    const englishEntries: unknown[] = Array.isArray(rawEnglishEntries) ? rawEnglishEntries : [];
    return englishEntries.reduce<WordCardData | null>((card, entry) => {
        if (!entry || typeof entry !== 'object') return card;
        return mergeWordCardData(card, parseWiktionaryRestEntry(entry as WiktionaryDefinitionEntry, normalizedWord));
    }, null);
}

async function lookupDatamuse(normalizedWord: string): Promise<WordCardData | null> {
    const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(normalizedWord)}&md=dpr&ipa=1&max=8`;
    const payload = await fetchJson(url);
    if (!Array.isArray(payload)) return null;
    return payload.reduce<WordCardData | null>((card, entry) => {
        if (!entry || typeof entry !== 'object') return card;
        const item = parseDatamuseWord(entry as DatamuseWord, normalizedWord);
        return item.meanings.length > 0 || item.phonetics.length > 0 ? mergeWordCardData(card, item) : card;
    }, null);
}

/** 构造默认词典 provider registry。 */
function createDefaultWordDictionaryProviders(): WordDictionaryProvider[] {
    return [
        createEcdictProvider(),
        {id: 'youdao-web', lookup: lookupYoudao},
        {id: 'free-dictionary', lookup: lookupFreeDictionary},
        {id: 'datamuse', lookup: lookupDatamuse},
        {id: 'wiktionary-rest', lookup: lookupWiktionaryRest},
        // 最后兜底的 WiktApi 在中国大陆可能不可达，因此保持最短超时。
        {id: 'wiktapi', lookup: lookupWiktApi},
    ];
}

function finalizeWordCard(card: WordCardData | null): WordCardData | null {
    if (!card) return null;
    card.phonetics = selectPronunciations(card.phonetics);
    return card;
}

interface WordDictionaryLookupOptions {
    readonly providers?: readonly WordDictionaryProvider[];
    readonly cacheSize?: number;
    readonly warn?: (message: string, error: unknown) => void;
}

interface WordDictionaryLookup {
    lookup(value: string): Promise<WordCardData | null>;
}

const DEFAULT_WORD_LOOKUP_CACHE_SIZE = 80;

/**
 * 创建可注入 provider 的词典查询服务。
 * 结果（包括未命中）会缓存；并发的同词查询共享一个 Promise，避免重复请求公共服务。
 */
function createWordDictionaryLookup(options: WordDictionaryLookupOptions = {}): WordDictionaryLookup {
    const providers = options.providers ? [...options.providers] : createDefaultWordDictionaryProviders();
    const cacheSize = options.cacheSize ?? DEFAULT_WORD_LOOKUP_CACHE_SIZE;
    if (!Number.isInteger(cacheSize) || cacheSize <= 0) throw new RangeError('词典缓存容量必须是正整数');
    const warn = options.warn ?? ((message: string, error: unknown) => console.warn(message, error));
    const resultCache = new Map<string, WordCardData | null>();
    const inFlight = new Map<string, Promise<WordCardData | null>>();

    const cacheResult = (word: string, result: WordCardData | null): WordCardData | null => {
        if (resultCache.size >= cacheSize) {
            const oldestWord = resultCache.keys().next().value as string;
            resultCache.delete(oldestWord);
        }
        resultCache.set(word, result);
        return result;
    };

    const performLookup = async (normalizedWord: string): Promise<WordCardData | null> => {
        let merged: WordCardData | null = null;
        for (const provider of providers) {
            try {
                const result = await provider.lookup(normalizedWord);
                if (hasUsefulData(result)) merged = mergeWordCardData(merged, result);
                // 释义、音标、英文原释义和非本地备份齐全后即可结束；音频仍可走浏览器 TTS。
                if (merged
                    && merged.meanings.length > 0
                    && merged.phonetics.length > 0
                    && hasEnglishDefinition(merged)
                    && hasNonLocalBackup(merged)) break;
            } catch (error) {
                // 单个公共服务失败不向 UI 泄漏内部错误，继续下一个 provider。
                warn(`[FluentRead] word provider ${provider.id} unavailable`, error);
            }
        }
        return finalizeWordCard(merged);
    };

    return {
        async lookup(value) {
            const normalizedWord = normalizeEnglishWord(value);
            if (!normalizedWord) return null;
            if (resultCache.has(normalizedWord)) return resultCache.get(normalizedWord) ?? null;
            const activeLookup = inFlight.get(normalizedWord);
            if (activeLookup) return activeLookup;

            const pending = performLookup(normalizedWord);
            inFlight.set(normalizedWord, pending);
            try {
                return cacheResult(normalizedWord, await pending);
            } finally {
                inFlight.delete(normalizedWord);
            }
        },
    };
}

const defaultWordDictionaryLookup = createWordDictionaryLookup();

/** 使用默认开放数据 provider 查询一个英语单词。 */
export function lookupWord(value: string): Promise<WordCardData | null> {
    return defaultWordDictionaryLookup.lookup(value);
}
