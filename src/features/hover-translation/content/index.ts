export interface HoverTranslationContentConfig {
    on?: boolean;
    hotkey?: string;
    customHotkey?: string;
    mouseHoverTranslationDelay?: number;
}

export interface HoverTranslationGestureConstants {
    TwoFinger: string;
    ThreeFinger: string;
    FourFinger: string;
    DoubleClick: string;
    LongPress: string;
    MiddleClick: string;
    DoubleClickScreen: string;
    TripleClickScreen: string;
}

export interface HoverTranslationContentDependencies {
    config: HoverTranslationContentConfig;
    constants: HoverTranslationGestureConstants;
    document: Document;
    window: Window;
    navigator: Navigator;
    isSiteDisabled: () => boolean;
    getCenterPoint: (touches: TouchList, requiredTouches: number) => { x: number; y: number } | null | undefined;
    handleTranslation: (mouseX: number, mouseY: number, delay?: number) => void;
    cancelPendingHoverTranslation: () => void;
    hasActiveSelectionTranslationCandidate: () => boolean;
    getConfiguredSelectionHotkey: () => string;
    getCustomSelectionHotkey: () => string | undefined;
    matchesSelectionTranslatorShortcut: (event: KeyboardEvent) => boolean;
    shouldReserveSelectionShortcut: (event: KeyboardEvent) => boolean;
}

interface HoverTranslationScreenState {
    mouseX: number;
    mouseY: number;
    hotkeyPressed: boolean;
    otherKeyPressed: boolean;
    hasSlideTranslation: boolean;
}

const SPECIAL_KEYS: Record<string, string> = {
    escape: 'escape',
    enter: 'enter',
    space: 'space',
    tab: 'tab',
    backspace: 'backspace',
    delete: 'delete',
    insert: 'insert',
    home: 'home',
    end: 'end',
    pageup: 'pageup',
    pagedown: 'pagedown',
    arrowup: 'arrowup',
    arrowdown: 'arrowdown',
    arrowleft: 'arrowleft',
    arrowright: 'arrowright',
};

export function normalizeHoverHotkeyParts(hotkeyString: string | undefined): string[] {
    if (!hotkeyString || hotkeyString === 'none') return [];

    return hotkeyString.split('+')
        .map(key => {
            const value = key.trim().toLowerCase();
            if (value === 'ctrl') return 'control';
            if (value === 'option') return 'alt';
            return value;
        })
        .filter(Boolean);
}

export function matchesPressedHotkeyParts(
    hotkeyParts: string[],
    pressed: ReadonlySet<string>,
): boolean {
    return hotkeyParts.length > 0
        && hotkeyParts.every(key => pressed.has(key))
        && hotkeyParts.length === pressed.size;
}

function addPressedKey(event: KeyboardEvent, pressed: Set<string>, isMac: boolean): void {
    if (event.altKey) pressed.add('alt');
    if (event.ctrlKey) pressed.add('control');
    if (event.metaKey && !isMac) pressed.add('control');
    if (event.shiftKey) pressed.add('shift');

    const key = event.key.toLowerCase();
    const code = event.code?.toLowerCase();
    if (code && code.startsWith('key')) {
        pressed.add(code.slice(3).toLowerCase());
    } else if (key.length === 1) {
        pressed.add(key);
    } else if (/^f\d+$/.test(key)) {
        pressed.add(key);
    } else if (SPECIAL_KEYS[key]) {
        pressed.add(SPECIAL_KEYS[key]);
    }
}

function removeReleasedKey(event: KeyboardEvent, pressed: Set<string>): void {
    const releasedKey = event.key.toLowerCase();
    const releasedCode = event.code?.toLowerCase();
    if (releasedCode && releasedCode.startsWith('key')) {
        pressed.delete(releasedCode.slice(3).toLowerCase());
    } else if (releasedKey.length === 1) {
        pressed.delete(releasedKey);
    } else if (/^f\d+$/.test(releasedKey)) {
        pressed.delete(releasedKey);
    } else if (SPECIAL_KEYS[releasedKey]) {
        pressed.delete(SPECIAL_KEYS[releasedKey]);
    }

    if (!event.altKey) pressed.delete('alt');
    if (!event.ctrlKey) pressed.delete('control');
    if (!event.metaKey) pressed.delete('control');
    if (!event.shiftKey) pressed.delete('shift');
}

export function mountHoverTranslationContentFeature(
    deps: HoverTranslationContentDependencies,
    signal: AbortSignal,
): void {
    const rootDocument = deps.document;
    const rootWindow = deps.window;
    const runtimeNavigator = deps.navigator;
    const screen: HoverTranslationScreenState = {
        mouseX: 0,
        mouseY: 0,
        hotkeyPressed: false,
        otherKeyPressed: false,
        hasSlideTranslation: false,
    };
    const mouseHotkeysPressed = new Set<string>();
    const isMac = /Mac|iPod|iPhone|iPad/.test(runtimeNavigator.platform);

    const getConfiguredMouseHotkeyParts = () => normalizeHoverHotkeyParts(
        deps.config.hotkey === 'custom' ? deps.config.customHotkey : deps.config.hotkey,
    );
    const getConfiguredSelectionHotkeyParts = () => {
        const hotkey = deps.getConfiguredSelectionHotkey();
        return normalizeHoverHotkeyParts(hotkey === 'custom' ? deps.getCustomSelectionHotkey() : hotkey);
    };

    const matchesPressed = (hotkeyParts: string[]) => matchesPressedHotkeyParts(hotkeyParts, mouseHotkeysPressed);

    const resetHoverHotkeyState = () => {
        screen.hotkeyPressed = false;
        screen.otherKeyPressed = false;
        screen.hasSlideTranslation = false;
        mouseHotkeysPressed.clear();
    };

    const cancelHoverForActiveSelection = (): boolean => {
        if (!screen.hotkeyPressed || !matchesPressed(getConfiguredSelectionHotkeyParts())) return false;
        if (!deps.hasActiveSelectionTranslationCandidate()) return false;
        screen.hotkeyPressed = false;
        screen.otherKeyPressed = true;
        screen.hasSlideTranslation = false;
        deps.cancelPendingHoverTranslation();
        return true;
    };

    rootDocument.addEventListener('selectionchange', cancelHoverForActiveSelection, { signal });

    rootWindow.addEventListener('blur', () => {
        resetHoverHotkeyState();
        deps.cancelPendingHoverTranslation();
    }, { signal });

    rootWindow.addEventListener('keydown', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        if (event.repeat) return;
        if (isMac && event.metaKey) return;

        const matchesSelectionShortcut = deps.matchesSelectionTranslatorShortcut(event);
        if (deps.shouldReserveSelectionShortcut(event)) {
            resetHoverHotkeyState();
            screen.otherKeyPressed = true;
            return;
        }

        // 记录当前可信按键集合，只有与配置完全一致时才进入悬浮候选态。
        addPressedKey(event, mouseHotkeysPressed, isMac);
        if (matchesPressed(getConfiguredMouseHotkeyParts())) {
            screen.hotkeyPressed = true;
            screen.otherKeyPressed = false;
            if (deps.config.on) {
                event.preventDefault();
                if (!matchesSelectionShortcut) event.stopPropagation();
            }
        } else if (screen.hotkeyPressed) {
            // Ctrl+C 等额外组合键会作废已排队的悬浮翻译。
            screen.otherKeyPressed = true;
            deps.cancelPendingHoverTranslation();
        }
    }, { signal, capture: true });

    rootDocument.addEventListener('pointerdown', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        if (!screen.hotkeyPressed || !matchesPressed(getConfiguredSelectionHotkeyParts())) return;
        // pointerdown 发生在新选区形成之前；共享划词快捷键已按下时先把拖选手势交给划词功能。
        screen.hotkeyPressed = false;
        screen.otherKeyPressed = true;
        screen.hasSlideTranslation = false;
        deps.cancelPendingHoverTranslation();
    }, { signal, capture: true });

    rootWindow.addEventListener('keyup', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        removeReleasedKey(event, mouseHotkeysPressed);

        if (screen.hotkeyPressed && mouseHotkeysPressed.size === 0 && !screen.otherKeyPressed && !screen.hasSlideTranslation) {
            if (deps.config.on) {
                event.preventDefault();
                event.stopPropagation();
                deps.handleTranslation(screen.mouseX, screen.mouseY);
            }
        }

        if (mouseHotkeysPressed.size === 0) resetHoverHotkeyState();
    }, { signal, capture: true });

    let longPressTimer: ReturnType<typeof setTimeout> | undefined;
    const longPressStart = { x: 0, y: 0 };

    rootDocument.addEventListener('mousemove', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        screen.mouseX = event.clientX;
        screen.mouseY = event.clientY;
        if (longPressTimer !== undefined
            && (Math.abs(event.clientX - longPressStart.x) > 10 || Math.abs(event.clientY - longPressStart.y) > 10)) {
            clearTimeout(longPressTimer);
            longPressTimer = undefined;
        }
        if (screen.hotkeyPressed && deps.config.on) {
            if (cancelHoverForActiveSelection()) return;
            screen.hasSlideTranslation = true;
            deps.handleTranslation(screen.mouseX, screen.mouseY, deps.config.mouseHoverTranslationDelay);
        }
    }, { signal });

    rootDocument.addEventListener('touchstart', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        let coordinate;
        switch (deps.config.hotkey) {
            case deps.constants.TwoFinger:
                coordinate = deps.getCenterPoint(event.touches, 2);
                break;
            case deps.constants.ThreeFinger:
                coordinate = deps.getCenterPoint(event.touches, 3);
                break;
            case deps.constants.FourFinger:
                coordinate = deps.getCenterPoint(event.touches, 4);
                break;
            default:
                return;
        }

        if (deps.config.on && coordinate) deps.handleTranslation(coordinate.x, coordinate.y);
    }, { signal, capture: true });

    rootDocument.addEventListener('dblclick', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        if (deps.config.hotkey === deps.constants.DoubleClick && deps.config.on) {
            deps.handleTranslation(event.clientX, event.clientY);
        }
    }, { signal });

    rootDocument.addEventListener('mouseup', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        if (longPressTimer !== undefined) clearTimeout(longPressTimer);
        longPressTimer = undefined;
    }, { signal });

    rootDocument.addEventListener('mousedown', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        if (deps.config.hotkey === deps.constants.LongPress) {
            if (longPressTimer !== undefined) clearTimeout(longPressTimer);
            longPressStart.x = event.clientX;
            longPressStart.y = event.clientY;
            longPressTimer = setTimeout(() => {
                longPressTimer = undefined;
                if (!deps.isSiteDisabled() && deps.config.on) {
                    deps.handleTranslation(event.clientX, event.clientY);
                }
            }, 500);
        }
    }, { signal });

    rootDocument.addEventListener('mousedown', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        if (deps.config.hotkey === deps.constants.MiddleClick && deps.config.on && event.button === 1) {
            deps.handleTranslation(event.clientX, event.clientY);
        }
    }, { signal });

    let touchCount = 0;
    let touchTimer: ReturnType<typeof setTimeout> | undefined;
    rootDocument.addEventListener('touchstart', event => {
        if (!event.isTrusted) return;
        if (deps.isSiteDisabled()) return;
        if (![deps.constants.DoubleClickScreen, deps.constants.TripleClickScreen].includes(deps.config.hotkey || '')
            || event.touches.length !== 1) return;

        const requiredTouches = deps.config.hotkey === deps.constants.DoubleClickScreen ? 2 : 3;
        touchCount += 1;

        if (touchCount === 1) {
            touchTimer = setTimeout(() => { touchCount = 0; }, 500);
        } else if (touchCount === requiredTouches) {
            clearTimeout(touchTimer);
            touchCount = 0;
            if (deps.config.on) deps.handleTranslation(event.touches[0].clientX, event.touches[0].clientY);
        }
    }, { signal });

    signal.addEventListener('abort', () => {
        if (longPressTimer !== undefined) clearTimeout(longPressTimer);
        clearTimeout(touchTimer);
    }, { once: true });
}
