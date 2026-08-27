import {afterEach, describe, expect, it, vi} from 'vitest';

import {
    matchesConfiguredHotkey,
    matchesHotkey,
    matchesModifierOnlyHotkey,
    parseHotkey,
    resolveConfiguredHotkey,
    shouldClaimConfiguredHotkey,
    validateHotkeyConflicts,
    type ParsedHotkey,
} from '@/src/core/hotkey';

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
        key: 't',
        code: 'KeyT',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...overrides,
    } as KeyboardEvent;
}

describe('hotkey parsing', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('拒绝空值、未知修饰键、未知普通键和单字母裸键', () => {
        expect(parseHotkey('')).toMatchObject({isValid: false, errorMessage: '快捷键不能为空'});
        expect(parseHotkey('Ctrl+Hyper+T')).toMatchObject({isValid: false, errorMessage: '不支持的修饰键: hyper'});
        expect(parseHotkey('Ctrl+Launch')).toMatchObject({isValid: false, errorMessage: '不支持的按键: launch'});
        expect(parseHotkey('a')).toMatchObject({isValid: false, errorMessage: '单个字母键需要与修饰键组合使用'});
    });

    it('合并重复修饰键并按平台生成展示名', () => {
        vi.stubGlobal('navigator', {platform: 'Linux x86_64'});
        expect(parseHotkey('Ctrl+Control+Alt+Space')).toEqual({
            modifiers: ['ctrl', 'alt'],
            key: 'space',
            isValid: true,
            displayName: 'Ctrl+Alt+Space',
        });

        vi.stubGlobal('navigator', {platform: 'MacIntel'});
        expect(parseHotkey('Option+Enter')).toEqual({
            modifiers: ['alt'],
            key: 'enter',
            isValid: true,
            displayName: 'Option+Enter',
        });
    });

    it('禁用 meta/cmd 组合并允许非字母裸键', () => {
        expect(parseHotkey('Cmd+K')).toMatchObject({
            isValid: false,
            errorMessage: 'CMD 键已被禁用，请使用其他修饰键组合',
        });
        expect(parseHotkey('F4')).toMatchObject({isValid: true, key: 'f4'});
        expect(parseHotkey('/')).toMatchObject({isValid: true, key: '/'});
    });
});

describe('hotkey matching', () => {
    it('无效解析结果和修饰键不完全匹配时不命中', () => {
        const parsed = parseHotkey('Ctrl+T');
        expect(matchesHotkey(keyboardEvent({ctrlKey: true}), {...parsed, isValid: false})).toBe(false);
        expect(matchesHotkey(keyboardEvent({ctrlKey: true, shiftKey: true}), parsed)).toBe(false);
        expect(matchesHotkey(keyboardEvent({altKey: true}), parsed)).toBe(false);
    });

    it('匹配特殊键、字母数字、功能键和符号键', () => {
        expect(matchesHotkey(keyboardEvent({key: ' ', code: 'Space', ctrlKey: true}), parseHotkey('Ctrl+Space'))).toBe(true);
        expect(matchesHotkey(keyboardEvent({key: 'Unidentified', code: 'ArrowDown', altKey: true}), parseHotkey('Alt+ArrowDown'))).toBe(true);
        expect(matchesHotkey(keyboardEvent({key: 'x', code: 'KeyX', ctrlKey: true}), parseHotkey('Ctrl+X'))).toBe(true);
        expect(matchesHotkey(keyboardEvent({key: 'Unidentified', code: 'KeyX', ctrlKey: true}), parseHotkey('Ctrl+X'))).toBe(true);
        expect(matchesHotkey(keyboardEvent({key: 'F4', code: 'F4', altKey: true}), parseHotkey('Alt+F4'))).toBe(true);
        expect(matchesHotkey(keyboardEvent({key: 'Unidentified', code: 'F4', altKey: true}), parseHotkey('Alt+F4'))).toBe(true);
        expect(matchesHotkey(keyboardEvent({key: '/', code: 'Slash', ctrlKey: true}), parseHotkey('Ctrl+/'))).toBe(true);
        expect(matchesHotkey(keyboardEvent({key: 'Enter', code: undefined, ctrlKey: true}), parseHotkey('Ctrl+Enter'))).toBe(true);
        expect(matchesHotkey(keyboardEvent({key: 'k', code: 'KeyK', metaKey: true}), {
            modifiers: ['meta'],
            key: 'k',
            isValid: true,
            displayName: 'Cmd+K',
        })).toBe(true);
    });

    it('匹配预设修饰键热键，并拒绝多余修饰键或错误按键', () => {
        expect(matchesModifierOnlyHotkey(keyboardEvent({key: 'Control', ctrlKey: true}), 'Control')).toBe(true);
        expect(matchesModifierOnlyHotkey(keyboardEvent({key: 'Alt', altKey: true}), 'Alt')).toBe(true);
        expect(matchesModifierOnlyHotkey(keyboardEvent({key: 'Shift', shiftKey: true}), 'Shift')).toBe(true);
        expect(matchesModifierOnlyHotkey(keyboardEvent({key: 'Control', ctrlKey: true, metaKey: true}), 'Control')).toBe(false);
        expect(matchesModifierOnlyHotkey(keyboardEvent({key: 'T', ctrlKey: true}), 'Control')).toBe(false);
        expect(matchesModifierOnlyHotkey(keyboardEvent({key: 'Control', ctrlKey: true}), 'Meta')).toBe(false);
    });

    it('解析配置热键并只在热键命中后检查候选文本', () => {
        expect(resolveConfiguredHotkey(' custom ', ' Ctrl+Shift+Y ')).toBe('Ctrl+Shift+Y');
        expect(resolveConfiguredHotkey('custom', undefined)).toBe('');
        expect(resolveConfiguredHotkey(' Alt ', 'Ctrl+Shift+Y')).toBe('Alt');
        expect(resolveConfiguredHotkey(undefined, undefined)).toBe('');

        expect(matchesConfiguredHotkey(keyboardEvent({key: 'Control', ctrlKey: true}), 'Control')).toBe(true);
        expect(matchesConfiguredHotkey(keyboardEvent({ctrlKey: true}), 'custom', 'Ctrl+T')).toBe(true);
        expect(matchesConfiguredHotkey(keyboardEvent({ctrlKey: true}), 'none')).toBe(false);
        expect(matchesConfiguredHotkey(keyboardEvent({ctrlKey: true}), '')).toBe(false);

        const hasCandidate = vi.fn(() => true);
        expect(shouldClaimConfiguredHotkey(keyboardEvent({altKey: true}), 'Ctrl+T', '', hasCandidate)).toBe(false);
        expect(hasCandidate).not.toHaveBeenCalled();
        expect(shouldClaimConfiguredHotkey(keyboardEvent({ctrlKey: true}), 'Ctrl+T', '', hasCandidate)).toBe(true);
    });
});

describe('hotkey conflict validation', () => {
    it('识别常见系统快捷键冲突并放行非冲突组合', () => {
        expect(validateHotkeyConflicts({isValid: false} as ParsedHotkey)).toEqual({hasConflict: false});
        expect(validateHotkeyConflicts(parseHotkey('Ctrl+C'))).toEqual({
            hasConflict: true,
            conflictDescription: '与系统快捷键冲突: 复制',
        });
        expect(validateHotkeyConflicts(parseHotkey('Ctrl+Shift+T'))).toEqual({
            hasConflict: true,
            conflictDescription: '与系统快捷键冲突: 重新打开关闭的标签页',
        });
        expect(validateHotkeyConflicts(parseHotkey('Ctrl+Alt+T'))).toEqual({hasConflict: false});
    });
});
