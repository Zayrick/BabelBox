const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'tel']);

export type InputBoxTrigger = 'triple_space' | 'triple_equal' | 'triple_dash';

/** 找到 Shadow DOM 内真正获得焦点的元素。 */
export function getDeepActiveElement(rootDocument: Document = document): Element | null {
    let activeElement: Element | null = rootDocument.activeElement;

    while (activeElement?.shadowRoot?.activeElement) {
        activeElement = activeElement.shadowRoot.activeElement;
    }

    return activeElement;
}
/** 判断元素是否是可翻译的文本输入目标。 */
export function isInputElement(element: Element | null): element is HTMLElement {
    if (!element) return false;
    if ('disabled' in element && Boolean((element as HTMLInputElement).disabled)) return false;
    if ('readOnly' in element && Boolean((element as HTMLInputElement | HTMLTextAreaElement).readOnly)) return false;

    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input') {
        return TEXT_INPUT_TYPES.has((element as HTMLInputElement).type.toLowerCase());
    }
    if (tagName === 'textarea') return true;

    return (element as HTMLElement).isContentEditable || ['true', 'plaintext-only'].includes(element.getAttribute('contenteditable') || '');
}

/** 获取输入目标中的纯文本。 */
export function getInputBoxText(element: HTMLElement): string {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'input' || tagName === 'textarea') {
        return (element as HTMLInputElement | HTMLTextAreaElement).value.trim();
    }

    return (element.innerText || element.textContent || '').trim();
}

/**
 * 获取输入目标的原始值快照。与 getInputBoxText 不同，这里保留首尾空白，
 * 用于确认异步翻译返回前用户是否编辑过输入框。
 */
export function getInputBoxValueSnapshot(element: HTMLElement): string {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'input' || tagName === 'textarea') {
        return (element as HTMLInputElement | HTMLTextAreaElement).value;
    }

    return element.innerText || element.textContent || '';
}

export interface InputBoxTranslationCommitState {
    signal: AbortSignal;
    expectedValue: string;
    currentValue: string;
    expectedConfigGeneration: number;
    currentConfigGeneration: number;
    isEnabled: boolean;
    isSiteDisabled: boolean;
}

/** 判断一个异步输入框翻译结果是否仍可安全写回页面。 */
export function canCommitInputBoxTranslation(state: InputBoxTranslationCommitState): boolean {
    return !state.signal.aborted
        && state.isEnabled
        && !state.isSiteDisabled
        && state.currentConfigGeneration === state.expectedConfigGeneration
        && state.currentValue === state.expectedValue;
}

/** 判断一次键盘事件是否匹配当前的三连击触发方式。 */
export function matchesInputBoxTrigger(event: KeyboardEvent, trigger: InputBoxTrigger): boolean {
    switch (trigger) {
        case 'triple_space':
            return event.key === ' ' || event.code === 'Space';
        case 'triple_equal':
            return event.key === '=' || (event.code === 'Equal' && !event.shiftKey);
        case 'triple_dash':
            return event.key === '-' || (event.code === 'Minus' && !event.shiftKey);
    }
}

/** 根据触发方式去除末尾的触发符号。 */
export function removeTriggerSymbols(text: string, trigger: string): string {
    const triggerSymbol = trigger === 'triple_space'
        ? ' '
        : trigger === 'triple_equal'
            ? '='
            : trigger === 'triple_dash'
                ? '-'
                : '';

    if (!triggerSymbol) return text;

    let cleanedText = text;
    while (cleanedText.endsWith(triggerSymbol)) {
        cleanedText = cleanedText.slice(0, -1);
    }

    return cleanedText.trim();
}
