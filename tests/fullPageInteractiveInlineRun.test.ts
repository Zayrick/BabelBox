import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

const runtime = vi.hoisted(() => ({
    requests: vi.fn<(origins: readonly string[]) => Promise<string[]>>(async (origins) => {
        return origins.map((origin) =>
            origin === 'show' ? '显示' : origin === 'Transcriptions' ? '转录' : `译:${origin}`);
    }),
    config: {
        service: 'microsoft',
        display: 0,
        to: 'zh',
        from: 'auto',
        useCache: true,
        animationMode: 'shimmer',
        fullPageTranslationMode: 'viewport' as const,
    },
    spinners: new Map<HTMLElement, HTMLElement>(),
}));

vi.mock('wxt/browser', () => ({browser: {runtime: {sendMessage: vi.fn(async () => undefined)}}}));
vi.mock('@/src/features/full-page-translation/content/configCheck', () => ({checkConfig: () => true}));
vi.mock('@/src/core/config/constants', () => ({
    styles: {singleTranslation: 0, bilingualTranslation: 1},
}));
vi.mock('@/src/services/config/store', () => ({config: runtime.config}));
vi.mock('@/src/core/language/detect', () => ({detectlang: () => ''}));
vi.mock('@/src/services/translation/client', () => ({
    translateText: async (origin: string) => (await runtime.requests([origin]))[0],
    translateTextBatch: (origins: readonly string[]) => runtime.requests(origins),
}));
vi.mock('@/src/services/translation/queue', () => ({
    createTranslationQueueSession: () => ({}),
    cancelTranslationQueueSession: () => undefined,
}));
vi.mock('@/src/features/full-page-translation/ui/translationIndicators', () => ({
    insertLoadingSpinner: (node: HTMLElement) => {
        const spinner = node.ownerDocument.createElement('span');
        spinner.className = 'fluent-read-loading';
        spinner.setAttribute('data-fr-translation-owned', 'true');
        spinner.setAttribute('data-animation-mode', 'shimmer');
        node.setAttribute('data-fr-translation-shimmer', 'true');
        node.appendChild(spinner);
        runtime.spinners.set(node, spinner);
        return spinner;
    },
    removeLoadingSpinner: (node: HTMLElement, spinner?: HTMLElement) => {
        node.removeAttribute('data-fr-translation-shimmer');
        spinner?.remove();
    },
    insertFailedTip: (node: HTMLElement) => {
        const retry = node.ownerDocument.createElement('span');
        retry.setAttribute('data-fr-translation-owned', 'true');
        node.appendChild(retry);
        return retry;
    },
}));
vi.mock('@/src/features/full-page-translation/content/renderer', () => ({
    appendBilingualTranslation: (node: HTMLElement, text: string) => {
        const content = node.ownerDocument.createElement('span');
        content.className = 'fluent-read-bilingual-content';
        content.setAttribute('data-fr-translation-owned', 'true');
        content.textContent = text;
        node.appendChild(content);
        return content;
    },
}));
vi.mock('@/src/features/full-page-translation/content/layout', () => ({
    ensureTranslationTruncationLayout: () => true,
}));

import {
    autoTranslateEnglishPage,
    restoreOriginalContent,
} from '@/src/features/full-page-translation/content/runtime';

class VisibleIntersectionObserver {
    static instances: VisibleIntersectionObserver[] = [];

    readonly observe = vi.fn((target: Element) => {
        queueMicrotask(() => this.callback(
            [{target, isIntersecting: true} as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
        ));
    });
    readonly unobserve = vi.fn();
    readonly disconnect = vi.fn();

    constructor(private readonly callback: IntersectionObserverCallback) {
        VisibleIntersectionObserver.instances.push(this);
    }
}

class TestMutationObserver {
    static instances: TestMutationObserver[] = [];

    readonly observe = vi.fn();
    readonly disconnect = vi.fn();
    readonly takeRecords = vi.fn(() => [] as MutationRecord[]);

    constructor(private readonly callback: MutationCallback) {
        TestMutationObserver.instances.push(this);
    }

    emit(records: MutationRecord[]): void {
        this.callback(records, this as unknown as MutationObserver);
    }
}

const replacedGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

function replaceGlobal(name: PropertyKey, value: unknown): void {
    if (!replacedGlobals.has(name)) replacedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
}

function setLayoutBox(element: Element): void {
    const rect = {width: 240, height: 24, top: 0, right: 240, bottom: 24, left: 0, x: 0, y: 0};
    Object.defineProperty(element, 'getClientRects', {
        configurable: true,
        value: () => Object.assign([rect], {item: (index: number) => index === 0 ? rect : null}),
    });
}

describe('全文翻译交互控件旁的 inline-run', () => {
    beforeEach(() => {
        runtime.requests.mockClear();
        runtime.spinners.clear();
        VisibleIntersectionObserver.instances = [];
        TestMutationObserver.instances = [];

        const {window, document} = parseHTML(`
            <html><head><title>MediaWiki fixture</title></head><body>
                <table class="infobox-subbox mw-collapsible mw-collapsed mw-made-collapsible">
                    <tbody><tr><th id="transcriptions" colspan="2" class="infobox-above">
                        <button type="button" class="mw-collapsible-toggle" aria-expanded="false">
                            <span class="mw-collapsible-text">show</span>
                        </button>Transcriptions
                    </th></tr></tbody>
                </table>
            </body></html>
        `);
        replaceGlobal('window', window);
        replaceGlobal('document', document);
        replaceGlobal('location', {href: 'https://en.wikipedia.org/wiki/Fixture'});
        replaceGlobal('Node', window.Node);
        replaceGlobal('Element', window.Element);
        replaceGlobal('HTMLElement', window.HTMLElement);
        replaceGlobal('Text', window.Text);
        replaceGlobal('ShadowRoot', window.ShadowRoot);
        replaceGlobal('DOMParser', window.DOMParser);
        replaceGlobal('CustomEvent', window.CustomEvent);
        replaceGlobal('MutationObserver', TestMutationObserver);
        replaceGlobal('IntersectionObserver', VisibleIntersectionObserver);

        document.querySelectorAll('th, button').forEach(setLayoutBox);
    });

    afterEach(() => {
        restoreOriginalContent();
        for (const [name, descriptor] of replacedGlobals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
        replacedGlobals.clear();
    });

    it('提交一次相邻正文翻译，不把自身的 synthetic 包装误判为宿主改写', async () => {
        const cell = document.querySelector<HTMLElement>('#transcriptions')!;
        const button = cell.querySelector<HTMLButtonElement>('button')!;
        const sourceText = Array.from(cell.childNodes).find((node) =>
            node.nodeType === Node.TEXT_NODE && node.nodeValue?.includes('Transcriptions')) as Text;

        autoTranslateEnglishPage();

        await vi.waitFor(() => {
            expect(button.textContent?.trim()).toBe('显示');
            expect(cell.textContent?.replace(/\s+/gu, '')).toBe('显示转录');
            expect(cell.querySelectorAll('[data-fr-translation-segment="true"]')).toHaveLength(1);
        });

        const segment = cell.querySelector<HTMLElement>('[data-fr-translation-segment="true"]')!;
        // A cache hit can commit before MutationObserver delivery. These are the
        // real source-migration records, now observed against the final translated
        // generation rather than its former loading phase.
        TestMutationObserver.instances.at(-1)!.emit([
            {
                type: 'childList',
                target: cell,
                addedNodes: [segment] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            },
            {
                type: 'childList',
                target: cell,
                addedNodes: [] as unknown as NodeList,
                removedNodes: [sourceText] as unknown as NodeList,
            },
            {
                type: 'childList',
                target: segment,
                addedNodes: [sourceText] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            },
            {
                type: 'childList',
                target: segment,
                addedNodes: [] as unknown as NodeList,
                removedNodes: [runtime.spinners.get(segment)!] as unknown as NodeList,
            },
            {
                type: 'childList',
                target: button,
                addedNodes: [] as unknown as NodeList,
                removedNodes: [runtime.spinners.get(button)!] as unknown as NodeList,
            },
        ] as unknown as MutationRecord[]);
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(runtime.requests.mock.calls.filter(([origins]) => origins.includes('Transcriptions'))).toHaveLength(1);
        expect(runtime.requests.mock.calls.filter(([origins]) => origins.includes('show'))).toHaveLength(1);
        expect(cell.querySelectorAll('[data-fr-translation-segment="true"]')).toHaveLength(1);
        expect(cell.textContent?.replace(/\s+/gu, '')).toBe('显示转录');
    });
});
