import { describe, expect, it, vi } from 'vitest';
import {
    canUseBundledDictionaryFallback,
    calculateSelectionPopupPosition,
    chooseSelectionRect,
    getSelectionPresentationDelayRemaining,
    isSameLanguage,
    isSelectionExcludedTagName,
    normalizeSelectionText,
    normalizeSpeechLanguage,
    reconcileSelectionPresentation,
    resolveSelectionDictionaryFallback,
    resolveSelectionVocabularyAnswer,
    SelectionRequestTokenGate,
    shouldIgnoreSelection,
    summarizeSelectionContext,
} from '@/src/features/selection-translation/core';
import {
    buildEdgeTtsSsml,
    edgeTtsVoiceCandidatesForLanguage,
    edgeTtsVoiceForLanguage,
    synthesizeEdgeTts,
} from '@/src/features/selection-translation/services/edgeTts';
import { matchesConfiguredHotkey, matchesModifierOnlyHotkey, resolveConfiguredHotkey, shouldClaimConfiguredHotkey } from '@/src/core/hotkey';
import { normalizeSelectionTtsVoiceOrder, selectionTtsVoiceLocale } from '@/src/features/selection-translation/ttsConfig';

interface MockElementOptions {
    tagName?: string;
    role?: string;
    attributes?: Record<string, string>;
    closestMatch?: boolean;
    isContentEditable?: boolean;
    parentElement?: MockElement | null;
}

class MockElement {
    readonly nodeType = 1;
    readonly tagName: string;
    readonly isContentEditable: boolean;
    parentElement: MockElement | null;
    private readonly attributes: Record<string, string>;
    private readonly closestMatch: boolean;

    constructor(options: MockElementOptions = {}) {
        this.tagName = options.tagName ?? 'P';
        this.attributes = options.attributes ?? {};
        this.closestMatch = options.closestMatch === true;
        this.isContentEditable = options.isContentEditable === true;
        this.parentElement = options.parentElement ?? null;
        if (options.role) this.attributes.role = options.role;
    }

    getAttribute(name: string): string | null {
        return this.attributes[name] ?? null;
    }

    hasAttribute(name: string): boolean {
        return Object.hasOwn(this.attributes, name);
    }

    closest(): MockElement | null {
        return this.closestMatch ? this : null;
    }
}

function mockTextNode(parentElement: MockElement | null): Node {
    return {nodeType: 3, parentElement} as Node;
}

function mockRange(start: Node | null, end: Node | null, cloneResult: boolean | 'throw'): Range {
    return {
        startContainer: start,
        endContainer: end,
        cloneContents: () => {
            if (cloneResult === 'throw') throw new Error('clone failed');
            return {
                querySelector: () => cloneResult ? {} : null,
            };
        },
    } as unknown as Range;
}

describe('selection translator core geometry', () => {
    const rects = [
        { top: 100, right: 300, bottom: 124, left: 80, width: 220, height: 24 },
        { top: 124, right: 180, bottom: 148, left: 80, width: 100, height: 24 },
    ];

    it('anchors a forward multi-line selection at its visual end', () => {
        expect(chooseSelectionRect(rects, true)).toEqual(rects[1]);
        expect(chooseSelectionRect(rects, false)).toEqual(rects[0]);
        expect(chooseSelectionRect([])).toBeNull();
    });

    it('keeps the popup above the selection when there is room', () => {
        expect(calculateSelectionPopupPosition({ ...rects[0], top: 300, bottom: 324 }, { width: 360, height: 160 }, { width: 1200, height: 800 })).toEqual({
            left: 80,
            top: 130,
            placement: 'top',
        });
    });

    it('flips below and clamps to the viewport near the top edge', () => {
        expect(calculateSelectionPopupPosition({ top: 20, right: 30, bottom: 42, left: 4, width: 26, height: 22 }, { width: 360, height: 160 }, { width: 390, height: 300 })).toEqual({
            left: 12,
            top: 52,
            placement: 'bottom',
        });
    });
});

describe('selection translator presentation stability', () => {
    it('keeps a live delay change anchored to the original selection time', () => {
        expect(getSelectionPresentationDelayRemaining(300, 1_000, 1_120)).toBe(180);
        expect(getSelectionPresentationDelayRemaining(100, 1_000, 1_120)).toBe(0);
        expect(getSelectionPresentationDelayRemaining(300, 1_000, 900)).toBe(300);
    });

    it('preserves an explicitly opened tooltip across unrelated config refreshes', () => {
        const openTooltip = {showIndicator: false, showTooltip: true};
        expect(reconcileSelectionPresentation(openTooltip, 'shortcut', false)).toBe(openTooltip);
        expect(reconcileSelectionPresentation(openTooltip, 'icon', false)).toBe(openTooltip);
        expect(reconcileSelectionPresentation(openTooltip, 'dot', false)).toBe(openTooltip);
    });

    it('updates presentation only when the configured trigger actually changes', () => {
        const openTooltip = {showIndicator: false, showTooltip: true};
        expect(reconcileSelectionPresentation(openTooltip, 'direct', true)).toEqual({showIndicator: false, showTooltip: true});
        expect(reconcileSelectionPresentation(openTooltip, 'icon', true)).toEqual({showIndicator: true, showTooltip: false});
        expect(reconcileSelectionPresentation(openTooltip, 'dot', true)).toEqual({showIndicator: true, showTooltip: false});
        expect(reconcileSelectionPresentation(openTooltip, 'shortcut', true)).toEqual({showIndicator: false, showTooltip: false});
    });
});

describe('selection translator async request generations', () => {
    it('keeps vocabulary lookup refreshes independent from an in-flight save', () => {
        const lookupGate = new SelectionRequestTokenGate();
        const saveGate = new SelectionRequestTokenGate();
        const saveToken = saveGate.begin();
        const firstLookup = lookupGate.begin();
        const refreshedLookup = lookupGate.begin();

        expect(lookupGate.isCurrent(firstLookup)).toBe(false);
        expect(lookupGate.isCurrent(refreshedLookup)).toBe(true);
        expect(saveGate.isCurrent(saveToken)).toBe(true);
    });

    it('invalidates both channels when the active selection is reset', () => {
        const lookupGate = new SelectionRequestTokenGate();
        const saveGate = new SelectionRequestTokenGate();
        const lookupToken = lookupGate.begin();
        const saveToken = saveGate.begin();

        lookupGate.invalidate();
        saveGate.invalidate();

        expect(lookupGate.isCurrent(lookupToken)).toBe(false);
        expect(saveGate.isCurrent(saveToken)).toBe(false);
    });
});

describe('selection translator text and speech language normalization', () => {
    it('matches detected languages with configured language families', () => {
        expect(isSameLanguage('zh-Hans', 'zh-Hant')).toBe(true);
        expect(isSameLanguage('eng', 'en')).toBe(true);
        expect(isSameLanguage('ja', 'en')).toBe(false);
        expect(isSameLanguage(undefined, 'en')).toBe(false);
        expect(isSameLanguage('en', undefined)).toBe(false);
        expect(isSameLanguage('und', 'en')).toBe(false);
        expect(isSameLanguage('en', 'auto')).toBe(false);
    });

    it('normalizes browser whitespace without changing words', () => {
        expect(normalizeSelectionText('  hello\u00a0  world\n   again  ')).toBe('hello world\nagain');
    });

    it('keeps a bounded context centered on the selected word', () => {
        expect(summarizeSelectionContext('', 'common')).toBe('');
        expect(summarizeSelectionContext('common text', '')).toBe('');
        expect(summarizeSelectionContext('common text', 'common', 10)).toBe('');
        const context = summarizeSelectionContext(`Before ${'a'.repeat(80)} common ${'b'.repeat(80)} after`, 'common', 64);
        expect(context).toHaveLength(64);
        expect(context).toContain('common');
        expect(context.startsWith('…')).toBe(true);
        expect(context.endsWith('…')).toBe(true);
        expect(summarizeSelectionContext('  A   common\nexample. ', 'common')).toBe('A common example.');
        expect(summarizeSelectionContext(`${'x'.repeat(80)} tail`, 'missing', 40)).toBe(`${'x'.repeat(39)}…`);
        const repeated = `common FIRST ${'x'.repeat(650)} common SECOND`;
        const lastCommon = repeated.lastIndexOf('common');
        const aroundLast = summarizeSelectionContext(repeated, 'common', 80, lastCommon);
        expect(aroundLast).toContain('SECOND');
        expect(aroundLast).not.toContain('FIRST');
        expect(summarizeSelectionContext(`${'x'.repeat(40)} common tail ${'y'.repeat(80)}`, 'common', 40, 0)).toContain('common');
        expect(summarizeSelectionContext(`${'x'.repeat(80)} common tail`, 'common', 40, 500)).toContain('common');
        expect(summarizeSelectionContext(`common left ${'x'.repeat(40)} common right`, 'common', 40, 45)).toContain('right');
        expect(summarizeSelectionContext(`common ${'x'.repeat(80)}`, 'common', 40, 0).startsWith('common')).toBe(true);
    });

    it('only exposes answers completed for the current selection request', () => {
        const current = {text: 'common', targetLanguage: 'zh-Hans', generation: 3};
        const translated = {...current, answer: '常见的'};
        const dictionary = {...current, answer: 'occurring often'};
        expect(resolveSelectionVocabularyAnswer(null, translated, dictionary)).toBe('');
        expect(resolveSelectionVocabularyAnswer(current, translated, dictionary)).toBe('常见的');
        expect(resolveSelectionVocabularyAnswer(current, {...translated, text: 'current'}, dictionary)).toBe('occurring often');
        expect(resolveSelectionVocabularyAnswer(current, {...translated, targetLanguage: 'ja'}, null)).toBe('');
        expect(resolveSelectionVocabularyAnswer(current, {...translated, generation: 2}, null)).toBe('');
    });

    it('only uses bundled ECDICT auxiliary text for Simplified Chinese targets', () => {
        expect(canUseBundledDictionaryFallback('zh-Hans')).toBe(true);
        expect(canUseBundledDictionaryFallback('')).toBe(false);
        expect(canUseBundledDictionaryFallback('ZH_cn')).toBe(true);
        expect(canUseBundledDictionaryFallback('zh-Hant')).toBe(false);
        expect(canUseBundledDictionaryFallback('ja')).toBe(false);
        expect(resolveSelectionDictionaryFallback('zh-Hans', [undefined, '', ' 常见 ', '共同'])).toBe('常见；共同');
        expect(resolveSelectionDictionaryFallback('ja', ['常见'])).toBe('');
    });

    it('classifies atomic and interactive elements as non-text selections', () => {
        for (const tagName of ['img', 'svg', 'video', 'canvas', 'button', 'input', 'textarea', 'select', 'code', 'pre']) {
            expect(isSelectionExcludedTagName(tagName)).toBe(true);
        }
        expect(isSelectionExcludedTagName('p')).toBe(false);
        expect(isSelectionExcludedTagName('span')).toBe(false);
    });

    it('忽略交互、可编辑和 FluentRead 自身 UI 内的选区', () => {
        expect(shouldIgnoreSelection(mockRange(
            new MockElement({tagName: 'IMG'}) as unknown as Node,
            new MockElement() as unknown as Node,
            false,
        ))).toBe(true);
        expect(shouldIgnoreSelection(mockRange(
            new MockElement({role: 'button'}) as unknown as Node,
            new MockElement() as unknown as Node,
            false,
        ))).toBe(true);
        expect(shouldIgnoreSelection(mockRange(
            new MockElement({isContentEditable: true}) as unknown as Node,
            new MockElement() as unknown as Node,
            false,
        ))).toBe(true);
        expect(shouldIgnoreSelection(mockRange(
            mockTextNode(new MockElement({attributes: {contenteditable: 'plaintext-only'}})),
            new MockElement() as unknown as Node,
            false,
        ))).toBe(true);
        expect(shouldIgnoreSelection(mockRange(
            mockTextNode(new MockElement({attributes: {contenteditable: 'false'}})),
            new MockElement({closestMatch: true}) as unknown as Node,
            false,
        ))).toBe(true);
    });

    it('在 fragment 检查失败时 fail-open，避免破坏普通文本选择', () => {
        expect(shouldIgnoreSelection(mockRange(
            null,
            mockTextNode(new MockElement()),
            false,
        ))).toBe(false);
        expect(shouldIgnoreSelection(mockRange(
            mockTextNode(new MockElement()),
            mockTextNode(new MockElement()),
            true,
        ))).toBe(true);
        expect(shouldIgnoreSelection(mockRange(
            mockTextNode(new MockElement()),
            mockTextNode(new MockElement()),
            'throw',
        ))).toBe(false);
    });

    it('maps translation language codes to browser speech language codes', () => {
        expect(normalizeSpeechLanguage('zh-Hans')).toBe('zh-CN');
        expect(normalizeSpeechLanguage('en')).toBe('en-US');
        expect(normalizeSpeechLanguage(undefined, 'fr-FR')).toBe('fr-FR');
        expect(normalizeSpeechLanguage('auto', 'zh-CN')).toBe('zh-CN');
        expect(normalizeSpeechLanguage('en-GB')).toBe('en-GB');
        expect(normalizeSpeechLanguage('invalid value')).toBe('en-US');
    });

    it('uses stable Edge TTS voices instead of the first system voice', () => {
        expect(edgeTtsVoiceForLanguage('en-US')).toBe('en-US-AvaMultilingualNeural');
        expect(edgeTtsVoiceForLanguage('en')).toBe('en-US-AvaMultilingualNeural');
        expect(edgeTtsVoiceForLanguage('zh-Hans')).toBe('zh-CN-XiaoxiaoMultilingualNeural');
    });

    it('keeps valid configured voices first and falls back through the same language', () => {
        expect(normalizeSelectionTtsVoiceOrder([
            'en-US-JennyNeural',
            'not-a-voice',
            'en-US-JennyNeural',
            'zh-CN-XiaoyiNeural',
        ])).toEqual(['en-US-JennyNeural', 'zh-CN-XiaoyiNeural']);
        expect(edgeTtsVoiceCandidatesForLanguage('en-US', [
            'en-GB-SoniaNeural',
            'en-US-JennyNeural',
            'zh-CN-XiaoyiNeural',
        ])).toEqual([
            'en-US-JennyNeural',
            'en-US-AvaMultilingualNeural',
            'en-US-AriaNeural',
            'en-US-GuyNeural',
        ]);
        expect(normalizeSelectionTtsVoiceOrder('en-US-JennyNeural')).toEqual([]);
        expect(selectionTtsVoiceLocale('zh-CN-XiaoxiaoMultilingualNeural')).toBe('zh-CN');
    });

    it('does not expose malformed Edge TTS endpoint JSON in errors', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => {
                throw new SyntaxError('Unexpected token S in SENSITIVE_TTS_RESPONSE_SENTINEL');
            },
        });
        vi.stubGlobal('fetch', fetchMock);

        try {
            const error = await synthesizeEdgeTts('hello', 'en-US').catch(cause => cause);

            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe('Edge TTS endpoint returned invalid JSON');
            expect((error as Error).message).not.toContain('SENSITIVE_TTS_RESPONSE_SENTINEL');
        } finally {
            vi.stubGlobal('fetch', originalFetch);
        }
    });

    it('continues to the next voice when Edge TTS rejects the first synthesis', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ t: 'test-token', r: 'eastus' }) })
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
        vi.stubGlobal('fetch', fetchMock);

        try {
            const result = await synthesizeEdgeTts('hello', 'en-US', ['en-US-JennyNeural', 'en-US-AvaMultilingualNeural']);
            expect(result.voice).toBe('en-US-AvaMultilingualNeural');
            expect(fetchMock).toHaveBeenCalledTimes(3);
            expect(String(fetchMock.mock.calls[1]?.[0])).toContain('.tts.speech.microsoft.com');
            expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('en-US-JennyNeural');
            expect(fetchMock.mock.calls[2]?.[1]?.body).toContain('en-US-AvaMultilingualNeural');
        } finally {
            vi.stubGlobal('fetch', originalFetch);
        }
    });

    it('aborts a pending Edge TTS synthesis instead of trying another voice', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).includes('/apps/endpoint')) {
                return Promise.resolve({ok: true, json: async () => ({t: 'abort-test-token', r: 'eastus'})} as Response);
            }
            return new Promise<Response>((_resolve, reject) => {
                const rejectAbort = () => {
                    const error = new Error('aborted');
                    error.name = 'AbortError';
                    reject(error);
                };
                init?.signal?.addEventListener('abort', rejectAbort, {once: true});
                if (init?.signal?.aborted) rejectAbort();
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();

        try {
            const request = synthesizeEdgeTts('cancel me', 'en-US', [], controller.signal);
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
            controller.abort();

            await expect(request).rejects.toMatchObject({name: 'AbortError'});
            const synthesisCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('.tts.speech.microsoft.com'));
            expect(synthesisCalls).toHaveLength(1);
            expect(synthesisCalls[0]?.[1]?.signal).toBe(controller.signal);
        } finally {
            vi.stubGlobal('fetch', originalFetch);
        }
    });

    it('escapes selection text before putting it into SSML', () => {
        const ssml = buildEdgeTtsSsml('A < B & C', 'en-US-AvaMultilingualNeural');
        expect(ssml).toContain('A &lt; B &amp; C');
        expect(ssml).not.toContain('A < B & C');
    });

    it('resolves preset and custom selection shortcuts consistently', () => {
        expect(resolveConfiguredHotkey('Control', 'Ctrl+Shift+Y')).toBe('Control');
        expect(resolveConfiguredHotkey('custom', ' Ctrl+Shift+Y ')).toBe('Ctrl+Shift+Y');
        expect(resolveConfiguredHotkey('none', 'Ctrl+Shift+Y')).toBe('none');
        expect(resolveConfiguredHotkey('custom', ' ')).toBe('');

        const modifierCases = [
            ['Control', {key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false}],
            ['Alt', {key: 'Alt', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false}],
            ['Shift', {key: 'Shift', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false}],
        ] as const;
        for (const [hotkey, event] of modifierCases) {
            expect(matchesModifierOnlyHotkey(event, hotkey)).toBe(true);
            expect(matchesConfiguredHotkey(event as KeyboardEvent, hotkey)).toBe(true);
        }

        const controlWithExtraModifier = {key: 'Control', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false} as KeyboardEvent;
        expect(matchesConfiguredHotkey(controlWithExtraModifier, 'Control')).toBe(false);
        expect(matchesConfiguredHotkey(controlWithExtraModifier, 'none')).toBe(false);
    });

    it('matches custom selection combinations without accepting extra modifiers', () => {
        const shortcut = {key: 'y', code: 'KeyY', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false} as KeyboardEvent;
        const extraModifier = {...shortcut, altKey: true} as KeyboardEvent;
        expect(matchesConfiguredHotkey(shortcut, 'custom', 'Ctrl+Shift+Y')).toBe(true);
        expect(matchesConfiguredHotkey(extraModifier, 'custom', 'Ctrl+Shift+Y')).toBe(false);
        expect(matchesConfiguredHotkey(shortcut, 'none', 'Ctrl+Shift+Y')).toBe(false);
    });

    it('does not inspect selection geometry for unrelated keyboard input', () => {
        const hasCandidate = vi.fn(() => true);
        const unrelated = {key: 'x', code: 'KeyX', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false} as KeyboardEvent;
        const control = {key: 'Control', code: 'ControlLeft', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false} as KeyboardEvent;

        expect(shouldClaimConfiguredHotkey(unrelated, 'Control', '', hasCandidate)).toBe(false);
        expect(hasCandidate).not.toHaveBeenCalled();
        expect(shouldClaimConfiguredHotkey(control, 'Control', '', hasCandidate)).toBe(true);
        expect(hasCandidate).toHaveBeenCalledTimes(1);
    });
});
