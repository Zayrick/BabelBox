import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    matchesPressedHotkeyParts,
    mountHoverTranslationContentFeature,
    normalizeHoverHotkeyParts,
    type HoverTranslationContentDependencies,
} from '@/src/features/hover-translation/content';

type Listener = (event: any) => unknown;

class FakeTarget {
    listeners = new Map<string, Listener[]>();

    addEventListener(type: string, listener: Listener, options?: AddEventListenerOptions): void {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
        expect(options).toBeTruthy();
    }

    emit(type: string, event: Record<string, unknown> = {}): void {
        for (const listener of this.listeners.get(type) || []) listener(event);
    }
}

function trustedEvent(event: Record<string, unknown> = {}): any {
    return {
        isTrusted: true,
        key: '',
        code: '',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        repeat: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...event,
    };
}

function mountHarness(overrides: Partial<HoverTranslationContentDependencies> = {}) {
    const documentTarget = new FakeTarget();
    const windowTarget = new FakeTarget();
    const config = {
        hotkey: 'Control',
        customHotkey: '',
        mouseHoverTranslationDelay: 120,
    };
    const deps: HoverTranslationContentDependencies = {
        config,
        constants: {
            TwoFinger: 'twoFinger',
            ThreeFinger: 'threeFinger',
            FourFinger: 'fourFinger',
            DoubleClick: 'doubleClick',
            LongPress: 'longPress',
            MiddleClick: 'middleClick',
            DoubleClickScreen: 'doubleClickScreen',
            TripleClickScreen: 'tripleClickScreen',
        },
        document: documentTarget as unknown as Document,
        window: windowTarget as unknown as Window,
        navigator: {platform: 'MacIntel'} as Navigator,
        isSiteDisabled: () => false,
        getCenterPoint: vi.fn(() => ({x: 7, y: 9})),
        handleTranslation: vi.fn(),
        cancelPendingHoverTranslation: vi.fn(),
        hasActiveSelectionTranslationCandidate: vi.fn(() => false),
        getConfiguredSelectionHotkey: () => 'Control',
        getCustomSelectionHotkey: () => '',
        matchesSelectionTranslatorShortcut: vi.fn(() => false),
        shouldReserveSelectionShortcut: vi.fn(() => false),
        ...overrides,
    };
    const controller = new AbortController();

    mountHoverTranslationContentFeature(deps, controller.signal);

    return {deps, documentTarget, windowTarget, controller};
}

afterEach(() => {
    vi.useRealTimers();
});

describe('hover translation content feature', () => {
    it('标准化组合键并要求按键集合精确匹配', () => {
        expect(normalizeHoverHotkeyParts(undefined)).toEqual([]);
        expect(normalizeHoverHotkeyParts('none')).toEqual([]);
        expect(normalizeHoverHotkeyParts(' Ctrl + Option + A ')).toEqual(['control', 'alt', 'a']);
        expect(matchesPressedHotkeyParts([], new Set())).toBe(false);
        expect(matchesPressedHotkeyParts(['control'], new Set(['control']))).toBe(true);
        expect(matchesPressedHotkeyParts(['control'], new Set(['control', 'c']))).toBe(false);
    });

    it('按住 hover 快捷键移动鼠标时延迟触发翻译，keyup 不重复触发', () => {
        const {deps, documentTarget, windowTarget} = mountHarness();
        const keydown = trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true});

        windowTarget.emit('keydown', keydown);
        documentTarget.emit('mousemove', trustedEvent({clientX: 10, clientY: 20}));
        windowTarget.emit('keyup', trustedEvent({key: 'Control', code: 'ControlLeft'}));

        expect(keydown.preventDefault).toHaveBeenCalledOnce();
        expect(deps.handleTranslation).toHaveBeenCalledWith(10, 20, 120);
        expect(deps.handleTranslation).toHaveBeenCalledTimes(1);
    });

    it('未移动时在释放完整快捷键后触发一次当前位置翻译', () => {
        const {deps, windowTarget} = mountHarness();

        windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        const keyup = trustedEvent({key: 'Control', code: 'ControlLeft'});
        windowTarget.emit('keyup', keyup);

        expect(keyup.preventDefault).toHaveBeenCalledOnce();
        expect(keyup.stopPropagation).toHaveBeenCalledOnce();
        expect(deps.handleTranslation).toHaveBeenCalledWith(0, 0);
    });

    it('站点禁用、非可信事件、重复按键和 macOS Command 都不会触发', () => {
        const {deps, documentTarget, windowTarget} = mountHarness({isSiteDisabled: () => true});

        windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        windowTarget.emit('keyup', trustedEvent({key: 'Control', code: 'ControlLeft'}));
        documentTarget.emit('mousemove', trustedEvent({clientX: 1, clientY: 2}));
        documentTarget.emit('dblclick', trustedEvent({clientX: 1, clientY: 2}));
        expect(deps.handleTranslation).not.toHaveBeenCalled();

        const enabled = mountHarness();
        enabled.windowTarget.emit('keydown', {...trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}), isTrusted: false});
        enabled.windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true, repeat: true}));
        enabled.windowTarget.emit('keydown', trustedEvent({key: 'Meta', code: 'MetaLeft', metaKey: true}));
        enabled.documentTarget.emit('mousemove', {...trustedEvent({clientX: 1, clientY: 2}), isTrusted: false});
        enabled.windowTarget.emit('keyup', {...trustedEvent({key: 'Control', code: 'ControlLeft'}), isTrusted: false});
        enabled.windowTarget.emit('keyup', trustedEvent({key: 'Control', code: 'ControlLeft'}));
        expect(enabled.deps.handleTranslation).not.toHaveBeenCalled();
    });

    it('额外按键、窗口失焦和有效选区会取消已进入候选态的悬浮翻译', () => {
        const hasSelection = vi.fn(() => true);
        const {deps, documentTarget, windowTarget} = mountHarness({hasActiveSelectionTranslationCandidate: hasSelection});

        windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        windowTarget.emit('keydown', trustedEvent({key: 'c', code: 'KeyC', ctrlKey: true}));
        expect(deps.cancelPendingHoverTranslation).toHaveBeenCalledOnce();
        documentTarget.emit('pointerdown', {...trustedEvent(), isTrusted: false});

        const pointerHarness = mountHarness({hasActiveSelectionTranslationCandidate: hasSelection});
        pointerHarness.windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        pointerHarness.documentTarget.emit('pointerdown', trustedEvent());
        expect(pointerHarness.deps.cancelPendingHoverTranslation).toHaveBeenCalledOnce();

        const idlePointer = mountHarness({hasActiveSelectionTranslationCandidate: hasSelection});
        idlePointer.documentTarget.emit('pointerdown', trustedEvent());
        expect(idlePointer.deps.cancelPendingHoverTranslation).not.toHaveBeenCalled();

        const customSelectionPointer = mountHarness({
            getConfiguredSelectionHotkey: () => 'custom',
            getCustomSelectionHotkey: () => 'Control',
            hasActiveSelectionTranslationCandidate: hasSelection,
        });
        customSelectionPointer.windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        customSelectionPointer.documentTarget.emit('pointerdown', trustedEvent());
        expect(customSelectionPointer.deps.cancelPendingHoverTranslation).toHaveBeenCalledOnce();

        const disabledPointer = mountHarness({
            isSiteDisabled: () => true,
            hasActiveSelectionTranslationCandidate: hasSelection,
        });
        disabledPointer.windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        disabledPointer.documentTarget.emit('pointerdown', trustedEvent());
        expect(disabledPointer.deps.cancelPendingHoverTranslation).not.toHaveBeenCalled();

        const selectionDragStart = mountHarness({
            hasActiveSelectionTranslationCandidate: () => false,
        });
        selectionDragStart.windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        selectionDragStart.documentTarget.emit('pointerdown', trustedEvent());
        expect(selectionDragStart.deps.cancelPendingHoverTranslation).toHaveBeenCalledOnce();

        const blurHarness = mountHarness({hasActiveSelectionTranslationCandidate: hasSelection});
        blurHarness.windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        blurHarness.windowTarget.emit('blur');
        expect(blurHarness.deps.cancelPendingHoverTranslation).toHaveBeenCalledOnce();
    });

    it('划词快捷键未匹配时，有选区也不会取消 hover 候选', () => {
        const {deps, documentTarget, windowTarget} = mountHarness({
            getConfiguredSelectionHotkey: () => 'Alt',
            hasActiveSelectionTranslationCandidate: () => true,
        });

        windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        documentTarget.emit('selectionchange', trustedEvent());
        documentTarget.emit('mousemove', trustedEvent({clientX: 12, clientY: 24}));

        expect(deps.cancelPendingHoverTranslation).not.toHaveBeenCalled();
        expect(deps.handleTranslation).toHaveBeenCalledWith(12, 24, 120);
    });

    it('selectionchange 在划词快捷键匹配且存在有效选区时取消 hover 候选', () => {
        const {deps, documentTarget, windowTarget} = mountHarness({
            hasActiveSelectionTranslationCandidate: () => true,
        });

        windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        documentTarget.emit('selectionchange', trustedEvent());
        documentTarget.emit('mousemove', trustedEvent({clientX: 12, clientY: 24}));

        expect(deps.cancelPendingHoverTranslation).toHaveBeenCalledOnce();
        expect(deps.handleTranslation).not.toHaveBeenCalled();
    });

    it('mousemove 触发前发现有效选区时取消 hover 候选', () => {
        const {deps, documentTarget, windowTarget} = mountHarness({
            hasActiveSelectionTranslationCandidate: () => true,
        });

        windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        documentTarget.emit('mousemove', trustedEvent({clientX: 12, clientY: 24}));

        expect(deps.cancelPendingHoverTranslation).toHaveBeenCalledOnce();
        expect(deps.handleTranslation).not.toHaveBeenCalled();
    });


    it('支持字母、功能键、特殊键、非 macOS meta 映射和 selection shortcut stopPropagation 分支', () => {
        const functionKey = mountHarness({navigator: {platform: 'Win32'} as Navigator});
        functionKey.deps.config.hotkey = 'F1';
        functionKey.windowTarget.emit('keydown', trustedEvent({key: 'F1', code: 'F1'}));
        functionKey.windowTarget.emit('keyup', trustedEvent({key: 'F1', code: 'F1'}));
        expect(functionKey.deps.handleTranslation).toHaveBeenCalledWith(0, 0);

        const singleCharacter = mountHarness();
        singleCharacter.deps.config.hotkey = 'x';
        singleCharacter.windowTarget.emit('keydown', trustedEvent({key: 'x', code: ''}));
        singleCharacter.windowTarget.emit('keyup', trustedEvent({key: 'x', code: ''}));
        singleCharacter.windowTarget.emit('keydown', trustedEvent({key: 'x', code: 'KeyX'}));
        singleCharacter.windowTarget.emit('keyup', trustedEvent({key: 'x', code: 'KeyX'}));
        expect(singleCharacter.deps.handleTranslation).toHaveBeenCalledWith(0, 0);

        const specialKey = mountHarness();
        specialKey.deps.config.hotkey = 'Escape';
        specialKey.windowTarget.emit('keydown', trustedEvent({key: 'Escape', code: 'Escape'}));
        specialKey.windowTarget.emit('keyup', trustedEvent({key: 'Escape', code: 'Escape'}));
        expect(specialKey.deps.handleTranslation).toHaveBeenCalledWith(0, 0);

        const metaKey = mountHarness({navigator: {platform: 'Win32'} as Navigator});
        metaKey.deps.config.hotkey = 'Control';
        metaKey.windowTarget.emit('keydown', trustedEvent({key: 'Meta', code: 'MetaLeft', metaKey: true}));
        metaKey.windowTarget.emit('keyup', trustedEvent({key: 'Meta', code: 'MetaLeft'}));
        expect(metaKey.deps.handleTranslation).toHaveBeenCalledWith(0, 0);

        const selectionShortcut = mountHarness({matchesSelectionTranslatorShortcut: () => true});
        const event = trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true});
        selectionShortcut.windowTarget.emit('keydown', event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).not.toHaveBeenCalled();

        const customCombo = mountHarness();
        customCombo.deps.config.hotkey = 'custom';
        customCombo.deps.config.customHotkey = 'Alt+Shift+x';
        customCombo.windowTarget.emit('keydown', trustedEvent({
            key: 'x',
            code: 'KeyX',
            altKey: true,
            shiftKey: true,
        }));
        customCombo.windowTarget.emit('keyup', trustedEvent({key: 'x', code: 'KeyX'}));
        expect(customCombo.deps.handleTranslation).toHaveBeenCalledWith(0, 0);
    });

    it('划词明确预留快捷键时清空 hover 状态并不阻止后续 selection 监听', () => {
        const {deps, windowTarget} = mountHarness({shouldReserveSelectionShortcut: () => true});

        windowTarget.emit('keydown', trustedEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true}));
        windowTarget.emit('keyup', trustedEvent({key: 'Control', code: 'ControlLeft'}));

        expect(deps.handleTranslation).not.toHaveBeenCalled();
    });

    it('支持触摸、双击、长按、中键和屏幕连击触发，并在 abort 时清理计时器', () => {
        vi.useFakeTimers();
        const {deps, documentTarget, controller} = mountHarness();

        deps.config.hotkey = 'twoFinger';
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 1, clientY: 2}, {clientX: 3, clientY: 4}]}));
        deps.config.hotkey = 'threeFinger';
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 1, clientY: 2}, {clientX: 3, clientY: 4}, {clientX: 5, clientY: 6}]}));
        deps.config.hotkey = 'fourFinger';
        documentTarget.emit('touchstart', trustedEvent({touches: [{}, {}, {}, {}]}));
        deps.config.hotkey = 'disabledGesture';
        documentTarget.emit('touchstart', trustedEvent({touches: [{}, {}]}));
        expect(deps.getCenterPoint).toHaveBeenCalledTimes(3);

        deps.config.hotkey = 'doubleClick';
        documentTarget.emit('dblclick', {...trustedEvent({clientX: 0, clientY: 0}), isTrusted: false});
        documentTarget.emit('dblclick', trustedEvent({clientX: 8, clientY: 9}));
        deps.config.hotkey = 'middleClick';
        documentTarget.emit('mousedown', {...trustedEvent({button: 1, clientX: 0, clientY: 0}), isTrusted: false});
        documentTarget.emit('mousedown', trustedEvent({button: 0, clientX: 0, clientY: 0}));
        documentTarget.emit('mousedown', trustedEvent({button: 1, clientX: 11, clientY: 13}));
        deps.config.hotkey = 'longPress';
        documentTarget.emit('mousedown', trustedEvent({clientX: 21, clientY: 34}));
        vi.advanceTimersByTime(500);

        deps.config.hotkey = 'doubleClickScreen';
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 55, clientY: 89}]}));
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 55, clientY: 89}]}));
        deps.config.hotkey = 'tripleClickScreen';
        documentTarget.emit('touchstart', {...trustedEvent({touches: [{clientX: 0, clientY: 0}]}), isTrusted: false});
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 0, clientY: 0}, {clientX: 1, clientY: 1}]}));
        deps.config.hotkey = 'middleClick';
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 0, clientY: 0}]}));
        deps.config.hotkey = undefined;
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 0, clientY: 0}]}));
        deps.config.hotkey = 'tripleClickScreen';
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 5, clientY: 8}]}));
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 5, clientY: 8}]}));
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 5, clientY: 8}]}));

        documentTarget.emit('mousedown', trustedEvent({clientX: 1, clientY: 1}));
        documentTarget.emit('mousemove', trustedEvent({clientX: 30, clientY: 30}));
        documentTarget.emit('mouseup', trustedEvent());
        controller.abort();

        expect(deps.handleTranslation).toHaveBeenCalledWith(7, 9);
        expect(deps.handleTranslation).toHaveBeenCalledWith(8, 9);
        expect(deps.handleTranslation).toHaveBeenCalledWith(11, 13);
        expect(deps.handleTranslation).toHaveBeenCalledWith(21, 34);
        expect(deps.handleTranslation).toHaveBeenCalledWith(55, 89);
        expect(deps.handleTranslation).toHaveBeenCalledWith(5, 8);
    });

    it('中键和屏幕连击在站点禁用时被 guard 拦截', () => {
        const {deps, documentTarget} = mountHarness({isSiteDisabled: () => true});

        deps.config.hotkey = 'middleClick';
        documentTarget.emit('mousedown', trustedEvent({button: 1, clientX: 1, clientY: 1}));
        deps.config.hotkey = 'doubleClickScreen';
        documentTarget.emit('touchstart', trustedEvent({touches: [{clientX: 1, clientY: 1}]}));

        expect(deps.handleTranslation).not.toHaveBeenCalled();
    });

    it('双击和 mouseup 在站点禁用或非可信事件时被 guard 拦截', () => {
        const disabled = mountHarness({isSiteDisabled: () => true});
        disabled.deps.config.hotkey = 'doubleClick';
        disabled.documentTarget.emit('dblclick', trustedEvent({clientX: 1, clientY: 1}));
        disabled.documentTarget.emit('mouseup', trustedEvent());

        const untrusted = mountHarness();
        untrusted.documentTarget.emit('mouseup', {...trustedEvent(), isTrusted: false});

        expect(disabled.deps.handleTranslation).not.toHaveBeenCalled();
        expect(untrusted.deps.handleTranslation).not.toHaveBeenCalled();
    });

    it('长按开始后移动超过阈值会取消本次长按翻译', () => {
        vi.useFakeTimers();
        const {deps, documentTarget} = mountHarness();

        deps.config.hotkey = 'longPress';
        documentTarget.emit('mousedown', trustedEvent({clientX: 1, clientY: 1}));
        documentTarget.emit('mousemove', trustedEvent({clientX: 30, clientY: 30}));
        vi.advanceTimersByTime(500);

        expect(deps.handleTranslation).not.toHaveBeenCalled();
    });

    it('长按开始后仅 Y 轴移动超过阈值也会取消本次长按翻译', () => {
        vi.useFakeTimers();
        const {deps, documentTarget} = mountHarness();

        deps.config.hotkey = 'longPress';
        documentTarget.emit('mousedown', trustedEvent({clientX: 1, clientY: 1}));
        documentTarget.emit('mousemove', trustedEvent({clientX: 5, clientY: 30}));
        vi.advanceTimersByTime(500);

        expect(deps.handleTranslation).not.toHaveBeenCalled();
    });

    it('mouseup 会清理尚未触发的长按计时器', () => {
        vi.useFakeTimers();
        const {deps, documentTarget} = mountHarness();

        deps.config.hotkey = 'longPress';
        documentTarget.emit('mousedown', trustedEvent({clientX: 1, clientY: 1}));
        documentTarget.emit('mouseup', trustedEvent());
        vi.advanceTimersByTime(500);

        expect(deps.handleTranslation).not.toHaveBeenCalled();
    });

    it('重复 mousedown 会替换上一轮长按计时器', () => {
        vi.useFakeTimers();
        const {deps, documentTarget} = mountHarness();

        deps.config.hotkey = 'longPress';
        documentTarget.emit('mousedown', trustedEvent({clientX: 1, clientY: 1}));
        documentTarget.emit('mousedown', trustedEvent({clientX: 2, clientY: 3}));
        vi.advanceTimersByTime(500);

        expect(deps.handleTranslation).toHaveBeenCalledOnce();
        expect(deps.handleTranslation).toHaveBeenCalledWith(2, 3);
    });

    it('abort 会清理尚未触发的长按计时器', () => {
        vi.useFakeTimers();
        const {deps, documentTarget, controller} = mountHarness();

        deps.config.hotkey = 'longPress';
        documentTarget.emit('mousedown', trustedEvent({clientX: 1, clientY: 1}));
        controller.abort();
        vi.advanceTimersByTime(500);

        expect(deps.handleTranslation).not.toHaveBeenCalled();
    });

});
