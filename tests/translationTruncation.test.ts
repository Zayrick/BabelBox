import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({
    config: {style: 1, to: 'zh-Hans'},
}));
vi.mock('@/src/core/config/catalog', () => ({
    options: {styles: []},
}));

import {
    findTranslationTruncationAncestors,
    hasActiveTranslationLineClamp,
} from '@/src/core/translation/public';
import {config} from '@/src/services/config/store';
import {options} from '@/src/core/config/catalog';
import {
    beginTranslation,
    restoreTranslation,
    setBilingualContent,
} from '@/src/features/full-page-translation/content/state';
import {ensureTranslationTruncationLayout} from '@/src/features/full-page-translation/content/layout';
import {appendBilingualTranslation} from '@/src/features/full-page-translation/content/renderer';

function installStylePriorityApi(element: HTMLElement): void {
    if (typeof element.style.getPropertyPriority === 'function') return;
    Object.defineProperty(Object.getPrototypeOf(element.style), 'getPropertyPriority', {
        configurable: true,
        value(this: CSSStyleDeclaration, property: string) {
            return /!important\s*$/iu.test(this.getPropertyValue(property)) ? 'important' : '';
        },
    });
}

function openRouterFixture() {
    const {document} = parseHTML(`
        <html><body>
            <div id="ordinary-overflow">
                <div id="clamp">
                    <div class="prose"><p id="first">A long model description for the first card.</p></div>
                    <p id="second">A second translated paragraph sharing the same clamp.</p>
                </div>
            </div>
        </body></html>
    `);
    const clamp = document.querySelector<HTMLElement>('#clamp')!;
    const ordinary = document.querySelector<HTMLElement>('#ordinary-overflow')!;
    const first = document.querySelector<HTMLElement>('#first')!;
    const second = document.querySelector<HTMLElement>('#second')!;
    installStylePriorityApi(clamp);
    const getComputedStyle = (element: Element) => {
        const lineClamp = element === clamp ? '2' : 'none';
        return {
            webkitLineClamp: lineClamp,
            getPropertyValue: (property: string) =>
                property === '-webkit-line-clamp' || property === 'line-clamp' ? lineClamp : '',
        } as unknown as CSSStyleDeclaration;
    };
    Object.defineProperty(document.defaultView, 'getComputedStyle', {
        configurable: true,
        value: getComputedStyle,
    });
    return {document, clamp, ordinary, first, second};
}

/** linkedom omits CSS priority APIs, so record the real setProperty calls explicitly. */
function trackStylePriorities(element: HTMLElement) {
    const style = element.style;
    const priorities = new Map<string, string>();
    const calls: Array<{property: string; value: string; priority: string}> = [];
    const initialStyle = element.getAttribute('style') ?? '';
    initialStyle.split(';').forEach((declaration) => {
        const separator = declaration.indexOf(':');
        if (separator < 0 || !/!important\s*$/iu.test(declaration)) return;
        priorities.set(declaration.slice(0, separator).trim().toLowerCase(), 'important');
    });
    const originalSetProperty = style.setProperty.bind(style);
    const originalRemoveProperty = style.removeProperty.bind(style);

    Object.defineProperties(style, {
        getPropertyPriority: {
            configurable: true,
            value: (property: string) => priorities.get(property.toLowerCase()) ?? '',
        },
        setProperty: {
            configurable: true,
            value: (property: string, value: string, priority = '') => {
                const normalizedPriority = priority.toLowerCase();
                calls.push({property, value, priority: normalizedPriority});
                originalSetProperty(property, value);
                if (normalizedPriority) priorities.set(property.toLowerCase(), normalizedPriority);
                else priorities.delete(property.toLowerCase());
            },
        },
        removeProperty: {
            configurable: true,
            value: (property: string) => {
                priorities.delete(property.toLowerCase());
                return originalRemoveProperty(property);
            },
        },
    });

    return {
        calls,
        getPriority: (property: string) => priorities.get(property.toLowerCase()) ?? '',
    };
}

async function withDocumentRealm<T>(
    document: Document,
    callback: () => Promise<T>,
): Promise<T> {
    const realm = document.defaultView as unknown as Record<string, unknown>;
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const realmBindings: Record<string, unknown> = {
        document,
        window: document.defaultView,
        DOMParser: class FixtureDOMParser {
            parseFromString(source: string): Document {
                return parseHTML(`<html><head></head><body>${source}</body></html>`).document;
            }
        },
        Element: realm.Element,
        HTMLElement: realm.HTMLElement,
        MutationObserver: realm.MutationObserver,
        Node: realm.Node,
        ShadowRoot: realm.ShadowRoot,
    };
    const previousDescriptors = new Map<string, PropertyDescriptor | undefined>();

    Object.entries(realmBindings).forEach(([name, value]) => {
        previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        if (value !== undefined) {
            Object.defineProperty(globalRecord, name, {
                configurable: true,
                writable: true,
                value,
            });
        }
    });

    try {
        return await callback();
    } finally {
        Object.keys(realmBindings).forEach((name) => {
            const descriptor = previousDescriptors.get(name);
            if (descriptor) Object.defineProperty(globalRecord, name, descriptor);
            else delete globalRecord[name];
        });
    }
}

describe('translation truncation layout', () => {
    it('finds the active OpenRouter-style ancestor but ignores ordinary overflow clipping', () => {
        const {clamp, ordinary, first} = openRouterFixture();

        expect(hasActiveTranslationLineClamp(clamp)).toBe(true);
        expect(hasActiveTranslationLineClamp(ordinary)).toBe(false);
        expect(findTranslationTruncationAncestors(first)).toEqual([clamp]);
    });

    it('includes a shared ancestor whose first lease has already removed its computed clamp', () => {
        const {clamp, first} = openRouterFixture();
        Object.defineProperty(first.ownerDocument.defaultView, 'getComputedStyle', {
            configurable: true,
            value: () => ({
                webkitLineClamp: 'none',
                getPropertyValue: () => '',
            } as unknown as CSSStyleDeclaration),
        });

        expect(findTranslationTruncationAncestors(first, (element) => element === clamp)).toEqual([clamp]);
    });

    it('leases a clipping host across an open ShadowRoot', () => {
        const {document} = parseHTML('<html><body><div id="host"></div></body></html>');
        const host = document.querySelector<HTMLElement>('#host')!;
        const owner = document.createElement('p');
        owner.textContent = 'Readable shadow content.';
        host.attachShadow({mode: 'open'}).appendChild(owner);
        installStylePriorityApi(host);
        host.style.setProperty('-webkit-line-clamp', '2');
        Object.defineProperty(document.defaultView, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => ({
                webkitLineClamp: element === host ? host.style.getPropertyValue('-webkit-line-clamp') : 'none',
                getPropertyValue: (property: string) =>
                    property === '-webkit-line-clamp' && element === host
                        ? host.style.getPropertyValue(property)
                        : '',
            } as CSSStyleDeclaration),
        });

        const attempt = beginTranslation(owner, 'bilingual')!;
        expect(ensureTranslationTruncationLayout(owner)).toBe(true);
        expect(host.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');

        attempt.state.phase = 'translated';
        expect(restoreTranslation(owner)).toBe(true);
        expect(host.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    });

    it('wires OpenRouter ancestor unclamping through the real bilingual renderer', async () => {
        const {document, clamp, first} = openRouterFixture();
        const originalClampStyle = '-webkit-line-clamp: 2 !important; max-height: 40px; color: red;';
        clamp.setAttribute('style', originalClampStyle);
        const priorityTracking = trackStylePriorities(clamp);

        await withDocumentRealm(document, async () => {
            const attempt = beginTranslation(first, 'bilingual')!;
            attempt.state.phase = 'translated';
            const wrapper = appendBilingualTranslation(first, '模型介绍已翻译。');
            setBilingualContent(first, wrapper);

            expect(wrapper.parentElement).toBe(first);
            expect(wrapper.textContent).toBe('模型介绍已翻译。');
            expect(wrapper.getAttribute('translate')).toBe('no');
            expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
            expect(priorityTracking.calls).toContainEqual({
                property: '-webkit-line-clamp',
                value: 'unset',
                priority: 'important',
            });

            expect(restoreTranslation(first)).toBe(true);
            expect(wrapper.isConnected).toBe(false);
            expect(clamp.getAttribute('style')).toBe(originalClampStyle);
        });
    });

    it('sanitizes renderer HTML while preserving safe inline markup and configured style class', async () => {
        const {document} = parseHTML('<html><body><p id="owner">Readable paragraph.</p></body></html>');
        Object.defineProperty(document, 'baseURI', {
            configurable: true,
            value: 'https://host.example/page',
        });
        const owner = document.querySelector<HTMLElement>('#owner')!;
        const previousConfig = {...config};
        const previousStyles = [...options.styles];

        await withDocumentRealm(document, async () => {
            try {
                Object.assign(config, {style: 7, to: ''});
                options.styles = [
                    {value: 7, class: 'babelbox-rendered-style'},
                    {value: 7, class: 'babelbox-disabled-style', disabled: true},
                ] as typeof options.styles;

                const attempt = beginTranslation(owner, 'bilingual')!;
                attempt.state.phase = 'translated';
                const wrapper = appendBilingualTranslation(owner, [
                    '<a href="https://example.com/read" title="Read"><strong>safe link</strong></a>',
                    '<a href="javascript:alert(1)" title="Unsafe">bad href</a>',
                    '<a href="http://[">bad url</a>',
                    '<div>block wrapper <em>keeps text</em></div>',
                    '<script>alert(1)</script>',
                    '<!--ignored comment-->',
                ].join(''));

                expect(wrapper.classList.contains('babelbox-rendered-style')).toBe(true);
                expect(wrapper.classList.contains('babelbox-disabled-style')).toBe(false);
                expect(wrapper.lang).toBe('');
                expect(wrapper.querySelector('script')).toBeNull();
                expect(wrapper.querySelector('div')).toBeNull();
                expect(wrapper.textContent).toContain('block wrapper keeps text');

                const links = wrapper.querySelectorAll('a');
                expect(links).toHaveLength(3);
                expect(links[0]!.getAttribute('href')).toBe('https://example.com/read');
                expect(links[0]!.getAttribute('title')).toBe('Read');
                expect(links[1]!.hasAttribute('href')).toBe(false);
                expect(links[1]!.getAttribute('title')).toBe('Unsafe');
                expect(links[2]!.hasAttribute('href')).toBe(false);

                restoreTranslation(owner);
            } finally {
                Object.assign(config, previousConfig);
                options.styles = previousStyles;
            }
        });
    });

    it('shares one clamp lease and restores its properties only after the last owner exits', () => {
        const {clamp, first, second} = openRouterFixture();
        clamp.setAttribute(
            'style',
            '-webkit-line-clamp: 2 !important; max-height: 40px; color: red;',
        );
        const firstAttempt = beginTranslation(first, 'bilingual')!;
        const secondAttempt = beginTranslation(second, 'bilingual')!;

        expect(ensureTranslationTruncationLayout(first)).toBe(true);
        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');

        expect(ensureTranslationTruncationLayout(second)).toBe(true);
        firstAttempt.state.phase = 'translated';
        expect(restoreTranslation(first)).toBe(true);
        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');

        clamp.style.setProperty('background-color', 'blue');
        secondAttempt.state.phase = 'translated';
        expect(restoreTranslation(second)).toBe(true);
        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toMatch(/^2(?: !important)?$/u);
        expect(clamp.style.getPropertyValue('max-height')).toBe('40px');
        expect(clamp.style.getPropertyValue('color')).toBe('red');
        expect(clamp.style.getPropertyValue('background-color')).toBe('blue');
        expect(clamp.style.getPropertyValue('line-clamp') ?? '').toBe('');
    });

    it('preserves a host clamp rewrite instead of restoring the stale pre-translation value', () => {
        const {clamp, first} = openRouterFixture();
        clamp.style.setProperty('-webkit-line-clamp', '2');
        const attempt = beginTranslation(first, 'bilingual')!;
        ensureTranslationTruncationLayout(first);

        clamp.style.setProperty('-webkit-line-clamp', '4', 'important');
        attempt.state.phase = 'translated';
        expect(restoreTranslation(first)).toBe(true);

        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('4');
    });

    it('restores the exact original style attribute when the host did not mutate it', () => {
        const {clamp, first} = openRouterFixture();
        const originalStyle = 'COLOR: red; -webkit-line-clamp: 2; max-height: 40px';
        clamp.setAttribute('style', originalStyle);
        const attempt = beginTranslation(first, 'bilingual')!;
        ensureTranslationTruncationLayout(first);
        attempt.state.phase = 'translated';

        expect(restoreTranslation(first)).toBe(true);
        expect(clamp.getAttribute('style')).toBe(originalStyle);
    });

    it('removes a temporary style attribute when the unclamped ancestor originally had none', () => {
        const {clamp, first} = openRouterFixture();
        expect(clamp.getAttribute('style')).toBeNull();
        const attempt = beginTranslation(first, 'bilingual')!;
        ensureTranslationTruncationLayout(first);
        expect(clamp.getAttribute('style')).not.toBeNull();

        attempt.state.phase = 'translated';
        expect(restoreTranslation(first)).toBe(true);
        expect(clamp.getAttribute('style')).toBeNull();
    });
});
