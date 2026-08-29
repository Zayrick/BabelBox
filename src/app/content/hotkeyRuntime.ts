import {config} from '@/src/services/config/store';
import {detectlang} from '@/src/core/language/detect';
import {matchesConfiguredHotkey, shouldClaimConfiguredHotkey} from '@/src/core/hotkey';
import {
    autoTranslateEnglishPage,
    isFullPageTranslationActive,
    isSameLanguage,
    normalizeSelectionText,
    restoreOriginalContent,
    shouldIgnoreSelection,
    toggleFloatingBallTranslation,
} from './features';

const SPECIAL_KEYS: Readonly<Record<string, string>> = {
    escape: 'escape',
    enter: 'enter',
    space: 'space',
    tab: 'tab',
    backspace: 'backspace',
    delete: 'delete',
    arrowup: 'arrowup',
    arrowdown: 'arrowdown',
    arrowleft: 'arrowleft',
    arrowright: 'arrowright',
    home: 'home',
    end: 'end',
    pageup: 'pageup',
    pagedown: 'pagedown',
    insert: 'insert',
};

export interface ContentHotkeyRuntime {
    getConfiguredSelectionHotkey(): string;
    hasActiveSelectionTranslationCandidate(): boolean;
    matchesSelectionTranslatorShortcut(event: KeyboardEvent): boolean;
    shouldReserveSelectionShortcut(event: KeyboardEvent): boolean;
    installFloatingBallHotkey(signal: AbortSignal): void;
}

/** 为单个 document 创建隔离的键盘状态，避免页面失效后残留按键组合。 */
export function createContentHotkeyRuntime(isSiteDisabled: () => boolean): ContentHotkeyRuntime {
    const activeSelectionCandidateByEvent = new WeakMap<KeyboardEvent, boolean>();

    const getConfiguredSelectionHotkey = (): string => {
        const trigger = config.selectionTranslatorTrigger;
        return ['Control', 'Alt', 'Shift', 'custom'].includes(trigger) ? trigger : 'none';
    };

    const hasActiveSelectionTranslationCandidate = (): boolean => {
        if (isSiteDisabled()) return false;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
        const selectionHost = document.getElementById('babelbox-selection-translator-container');
        if (selectionHost && selection.containsNode(selectionHost, true)) return false;

        const text = normalizeSelectionText(selection.toString());
        if (!text || text.length > 4096 || isSameLanguage(detectlang(text), config.to)) return false;

        const range = selection.getRangeAt(0);
        if (shouldIgnoreSelection(range)) return false;
        if (Array.from(range.getClientRects()).some((rect) => rect.width > 0 || rect.height > 0)) return true;
        const bounds = range.getBoundingClientRect();
        return bounds.width > 0 || bounds.height > 0;
    };

    const shouldReserveSelectionShortcut = (event: KeyboardEvent): boolean => {
        if (isSiteDisabled() || !config.on || config.selectionTranslatorMode === 'disabled'
            || config.disableSelectionTranslator) return false;
        return shouldClaimConfiguredHotkey(
            event,
            getConfiguredSelectionHotkey(),
            config.customSelectionTranslatorHotkey,
            () => {
                const cached = activeSelectionCandidateByEvent.get(event);
                if (cached !== undefined) return cached;
                const candidate = hasActiveSelectionTranslationCandidate();
                activeSelectionCandidateByEvent.set(event, candidate);
                return candidate;
            },
        );
    };

    const matchesSelectionTranslatorShortcut = (event: KeyboardEvent): boolean => {
        if (isSiteDisabled() || !config.on || config.selectionTranslatorMode === 'disabled'
            || config.disableSelectionTranslator) return false;
        return matchesConfiguredHotkey(
            event,
            getConfiguredSelectionHotkey(),
            config.customSelectionTranslatorHotkey,
        );
    };

    const toggleFullPageTranslation = (): void => {
        if (toggleFloatingBallTranslation()) return;
        if (isFullPageTranslationActive()) restoreOriginalContent();
        else autoTranslateEnglishPage();
    };

    const installFloatingBallHotkey = (signal: AbortSignal): void => {
        const hotkeysPressed = new Set<string>();
        let pendingFullPageToggle = false;
        const isDev = process.env.NODE_ENV === 'development';
        const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

        const configuredParts = (): string[] => {
            const configured = config.floatingBallHotkey === 'custom'
                ? config.customFloatingBallHotkey
                : config.floatingBallHotkey;
            if (!configured || configured === 'none') return [];
            return configured.split('+').map((key) => {
                const normalized = key.toLowerCase();
                if (normalized === 'ctrl') return 'control';
                if (normalized === 'option') return 'alt';
                return normalized;
            });
        };

        const addEventKey = (event: KeyboardEvent): void => {
            const key = event.key.toLowerCase();
            const code = event.code?.toLowerCase();
            if (code?.startsWith('key')) hotkeysPressed.add(code.slice(3).toLowerCase());
            else if (key.length === 1 || /^f\d+$/.test(key)) hotkeysPressed.add(key);
            else if (SPECIAL_KEYS[key]) hotkeysPressed.add(SPECIAL_KEYS[key]);
        };

        const removeEventKey = (event: KeyboardEvent): void => {
            const key = event.key.toLowerCase();
            const code = event.code?.toLowerCase();
            if (code?.startsWith('key')) hotkeysPressed.delete(code.slice(3).toLowerCase());
            else if (key.length === 1 || /^f\d+$/.test(key)) hotkeysPressed.delete(key);
            else if (SPECIAL_KEYS[key]) hotkeysPressed.delete(SPECIAL_KEYS[key]);
        };

        if (isDev) {
            console.log(`[BabelBox] 设置悬浮球快捷键: ${config.floatingBallHotkey}, 系统: ${isMac ? 'macOS' : '其他'}`);
        }

        document.addEventListener('keydown', (event) => {
            if (!event.isTrusted) return;
            if (isSiteDisabled() || event.repeat || (isMac && event.metaKey)) return;

            // 划词与全文快捷键冲突时，有有效选区的划词翻译拥有本次按键。
            if (shouldReserveSelectionShortcut(event)) {
                pendingFullPageToggle = false;
                hotkeysPressed.clear();
                return;
            }

            if (event.altKey) hotkeysPressed.add('alt');
            if (event.ctrlKey) hotkeysPressed.add('control');
            if (event.metaKey && !isMac) hotkeysPressed.add('control');
            if (event.shiftKey) hotkeysPressed.add('shift');
            addEventKey(event);

            const parts = configuredParts();
            if (parts.length === 0
                || !parts.every((key) => hotkeysPressed.has(key))
                || parts.length !== hotkeysPressed.size
                || !config.on) return;

            event.preventDefault();
            event.stopPropagation();
            if (matchesSelectionTranslatorShortcut(event)) {
                pendingFullPageToggle = !matchesConfiguredHotkey(event, config.hotkey, config.customHotkey);
                return;
            }

            toggleFullPageTranslation();
            if (isDev) {
                const activeHotkey = config.floatingBallHotkey === 'custom'
                    ? config.customFloatingBallHotkey
                    : config.floatingBallHotkey;
                console.log(`[BabelBox] 触发悬浮球翻译，快捷键: ${activeHotkey}`);
            }
        }, {signal, capture: true});

        document.addEventListener('keyup', (event) => {
            if (!event.isTrusted) return;
            if (isSiteDisabled()) return;
            if (pendingFullPageToggle) {
                pendingFullPageToggle = false;
                if (config.on && !hasActiveSelectionTranslationCandidate()) {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleFullPageTranslation();
                }
            }
            removeEventKey(event);
            if (!event.altKey) hotkeysPressed.delete('alt');
            if (!event.ctrlKey) hotkeysPressed.delete('control');
            if (!event.metaKey) hotkeysPressed.delete('control');
            if (!event.shiftKey) hotkeysPressed.delete('shift');
        }, {signal, capture: true});

        window.addEventListener('blur', () => {
            pendingFullPageToggle = false;
            hotkeysPressed.clear();
        }, {signal});
    };

    return {
        getConfiguredSelectionHotkey,
        hasActiveSelectionTranslationCandidate,
        matchesSelectionTranslatorShortcut,
        shouldReserveSelectionShortcut,
        installFloatingBallHotkey,
    };
}
