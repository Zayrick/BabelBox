export interface SelectionRect {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
}

export interface PopupSize {
    width: number;
    height: number;
}

export interface ViewportSize {
    width: number;
    height: number;
}

export interface PopupPosition {
    left: number;
    top: number;
    placement: 'top' | 'bottom';
}

export interface SelectionContentRequest {
    text: string;
    targetLanguage: string;
    generation: number;
}

export interface SelectionAnswerCandidate extends SelectionContentRequest {
    answer: string;
}

/** Keep independent async channels from invalidating one another's completion. */
export class SelectionRequestTokenGate {
    private generation = 0;

    begin(): number {
        this.generation += 1;
        return this.generation;
    }

    invalidate(): void {
        this.generation += 1;
    }

    isCurrent(token: number): boolean {
        return token === this.generation;
    }
}

function normalizeSelectionRequestLanguage(value: string): string {
    return value.trim().replace(/_/g, '-').toLowerCase();
}

/** ECDICT's bundled auxiliary definitions are Simplified Chinese. */
function canUseBundledDictionaryFallback(targetLanguage: string): boolean {
    return ['zh', 'zh-cn', 'zh-hans', 'zh-sg'].includes(normalizeSelectionRequestLanguage(targetLanguage));
}

export function resolveSelectionDictionaryFallback(targetLanguage: string, translatedDefinitions: readonly unknown[]): string {
    if (!canUseBundledDictionaryFallback(targetLanguage)) return '';
    return translatedDefinitions
        .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        .map(value => value.trim())
        .slice(0, 4)
        .join('；');
}

export function resolveSelectionVocabularyAnswer(
    current: SelectionContentRequest | null,
    translation: SelectionAnswerCandidate | null,
    dictionary: SelectionAnswerCandidate | null,
): string {
    if (!current) return '';
    const matches = (candidate: SelectionAnswerCandidate | null): candidate is SelectionAnswerCandidate => Boolean(
        candidate
        && candidate.generation === current.generation
        && candidate.text === current.text
        && normalizeSelectionRequestLanguage(candidate.targetLanguage) === normalizeSelectionRequestLanguage(current.targetLanguage)
        && candidate.answer.trim(),
    );
    if (matches(translation)) return translation.answer.trim();
    return matches(dictionary) ? dictionary.answer.trim() : '';
}

export interface SelectionPresentationState {
    showIndicator: boolean;
    showTooltip: boolean;
}

export type SelectionPresentationTrigger = 'direct' | 'icon' | 'dot' | 'shortcut';

/** Keep delay changes anchored to when the current selection became stable. */
export function getSelectionPresentationDelayRemaining(
    delay: number,
    selectionSettledAt: number,
    now: number,
): number {
    const elapsed = Math.max(0, now - selectionSettledAt);
    return Math.max(0, delay - elapsed);
}

/** Preserve an explicitly opened tooltip across unrelated config refreshes. */
export function reconcileSelectionPresentation(
    current: SelectionPresentationState,
    trigger: SelectionPresentationTrigger,
    triggerChanged: boolean,
): SelectionPresentationState {
    if (!triggerChanged) return current;
    if (trigger === 'direct') return { showIndicator: false, showTooltip: true };
    if (trigger === 'shortcut') return { showIndicator: false, showTooltip: false };
    return { showIndicator: true, showTooltip: false };
}

const languageAliases: Record<string, string> = {
    cmn: 'zh',
    zho: 'zh',
    chi: 'zh',
    eng: 'en',
    jpn: 'ja',
    kor: 'ko',
    fra: 'fr',
    fre: 'fr',
    deu: 'de',
    ger: 'de',
    spa: 'es',
    rus: 'ru',
    ita: 'it',
    por: 'pt',
    ara: 'ar',
    hin: 'hi',
    tha: 'th',
    vie: 'vi',
    nld: 'nl',
    dut: 'nl',
    pol: 'pl',
    tur: 'tr',
};

/** Compare detected and configured languages without depending on region/script details. */
export function isSameLanguage(detectedLanguage: string | undefined, targetLanguage: string | undefined): boolean {
    const detected = (detectedLanguage ?? '').trim().replace(/_/g, '-').toLowerCase();
    const target = (targetLanguage ?? '').trim().replace(/_/g, '-').toLowerCase();
    if (!detected || !target || ['auto', 'detect', 'unknown', 'und'].includes(detected) || ['auto', 'detect', 'unknown', 'und'].includes(target)) return false;

    const detectedBase = languageAliases[detected] || detected.split('-')[0];
    const targetBase = languageAliases[target] || target.split('-')[0];
    return Boolean(detectedBase && targetBase && detectedBase === targetBase);
}

const DEFAULT_PADDING = 12;
const DEFAULT_GAP = 10;

/** Normalize browser selection text without destroying meaningful line breaks. */
export function normalizeSelectionText(value: string): string {
    return value
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .trim();
}

export function summarizeSelectionContext(
    containerText: string,
    selectedText: string,
    maxLength = 500,
    selectedIndex?: number,
): string {
    const normalized = containerText.replace(/\s+/gu, ' ').trim();
    const selected = selectedText.trim();
    if (!normalized || !selected || maxLength < 16) return '';
    if (normalized.length <= maxLength) return normalized;
    const normalizedLower = normalized.toLocaleLowerCase();
    const selectedLower = selected.toLocaleLowerCase();
    const firstIndex = normalizedLower.indexOf(selectedLower);
    if (firstIndex < 0) return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
    let matchedIndex = firstIndex;
    if (selectedIndex !== undefined) {
        const preferredIndex = Math.max(0, Math.min(normalized.length, selectedIndex));
        const leftIndex = normalizedLower.lastIndexOf(selectedLower, preferredIndex);
        const rightIndex = normalizedLower.indexOf(selectedLower, preferredIndex);
        if (leftIndex < 0) matchedIndex = rightIndex;
        else if (rightIndex < 0) matchedIndex = leftIndex;
        else matchedIndex = preferredIndex - leftIndex <= rightIndex - preferredIndex ? leftIndex : rightIndex;
    }
    const contentLength = Math.max(1, maxLength - 2);
    const selectedCenter = matchedIndex + selected.length / 2;
    const start = Math.max(0, Math.min(normalized.length - contentLength, Math.round(selectedCenter - contentLength / 2)));
    const end = Math.min(normalized.length, start + contentLength);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < normalized.length ? '…' : '';
    return `${prefix}${normalized.slice(start, end).trim()}${suffix}`.slice(0, maxLength);
}

const selectionExcludedTagNames = new Set([
    'audio', 'button', 'canvas', 'code', 'embed', 'iframe', 'img', 'input',
    'kbd', 'math', 'object', 'option', 'picture', 'pre', 'samp', 'select',
    'svg', 'template', 'textarea', 'var', 'video',
]);

const selectionExcludedRoles = new Set([
    'button', 'checkbox', 'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'radio', 'scrollbar', 'slider', 'spinbutton',
    'switch', 'tab', 'textbox',
]);

const selectionExcludedSelector = [
    '.babelbox-bilingual-content',
    '.babelbox-loading',
    '.babelbox-retry-wrapper',
    '.notranslate',
    '[aria-hidden="true"]',
    '[data-babelbox-ui]',
    '[data-notranslate="true"]',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="scrollbar"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="textbox"]',
    '[translate="no"]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    ...Array.from(selectionExcludedTagNames, (tagName) => tagName),
].join(',');

function isSelectionExcludedTagName(tagName: string): boolean {
    return selectionExcludedTagNames.has(tagName.trim().toLowerCase());
}

function isEditableSelectionElement(element: Element): boolean {
    if ((element as HTMLElement).isContentEditable) return true;

    let current: Element | null = element;
    while (current) {
        if (current.hasAttribute('contenteditable')) {
            return current.getAttribute('contenteditable')?.trim().toLowerCase() !== 'false';
        }
        current = current.parentElement;
    }
    return false;
}

function isSelectionExcludedElement(element: Element | null): boolean {
    if (!element) return false;
    if (isSelectionExcludedTagName(element.tagName)) return true;

    const role = element.getAttribute('role')?.trim().toLowerCase();
    if (role && selectionExcludedRoles.has(role)) return true;
    if (isEditableSelectionElement(element)) return true;
    return Boolean(element.closest(selectionExcludedSelector));
}

function elementFromSelectionNode(node: Node | null): Element | null {
    if (!node) return null;
    return node.nodeType === 1 ? node as Element : node.parentElement;
}

/**
 * Selection translation is intended for page prose, not atomic or interactive
 * widgets. Check both boundaries and the cloned range so image-only selections
 * and selections that cross a special component do not leave a stale trigger.
 */
export function shouldIgnoreSelection(range: Range): boolean {
    const boundaries = [
        elementFromSelectionNode(range.startContainer),
        elementFromSelectionNode(range.endContainer),
    ];
    if (boundaries.some(isSelectionExcludedElement)) return true;

    return Boolean(range.cloneContents().querySelector(selectionExcludedSelector));
}

/**
 * Select the visual edge closest to the selection focus. Using client rects
 * avoids placing the affordance in the middle of a multi-line selection.
 */
export function chooseSelectionRect(rects: SelectionRect[], isForward = true): SelectionRect | null {
    if (rects.length === 0) return null;
    return isForward ? rects[rects.length - 1] : rects[0];
}

/**
 * Position the popover against the selected line and keep it inside the
 * viewport. The calculation is pure so scroll/resize behavior can be tested
 * without mounting Vue or depending on a page's CSS.
 */
export function calculateSelectionPopupPosition(
    anchor: SelectionRect,
    popup: PopupSize,
    viewport: ViewportSize,
    padding = DEFAULT_PADDING,
    gap = DEFAULT_GAP,
): PopupPosition {
    const maxLeft = Math.max(padding, viewport.width - popup.width - padding);
    const left = clamp(anchor.left, padding, maxLeft);
    const fitsAbove = anchor.top - popup.height - gap >= padding;
    const placement = fitsAbove ? 'top' : 'bottom';
    const rawTop = fitsAbove ? anchor.top - popup.height - gap : anchor.bottom + gap;
    const maxTop = Math.max(padding, viewport.height - popup.height - padding);

    return {
        left,
        top: clamp(rawTop, padding, maxTop),
        placement,
    };
}

export function normalizeSpeechLanguage(language: string | undefined, fallback = 'en-US'): string {
    const normalized = (language ?? '').trim().replace(/_/g, '-');
    const lower = normalized.toLowerCase();
    if (!normalized || ['auto', 'detect', 'unknown', 'und'].includes(lower)) return fallback;

    const aliases: Record<string, string> = {
        'zh': 'zh-CN',
        'zh-hans': 'zh-CN',
        'zh-cn': 'zh-CN',
        'zh-hant': 'zh-TW',
        'zh-tw': 'zh-TW',
        'en': 'en-US',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'es': 'es-ES',
        'it': 'it-IT',
        'pt': 'pt-BR',
        'ru': 'ru-RU',
    };

    if (aliases[lower]) return aliases[lower];
    return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(normalized) ? normalized : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
