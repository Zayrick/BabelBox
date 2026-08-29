import { describe, expect, it } from 'vitest';
import {
    canCommitInputBoxTranslation,
    getDeepActiveElement,
    getInputBoxText,
    getInputBoxValueSnapshot,
    isInputElement,
    matchesInputBoxTrigger,
    removeTriggerSymbols,
} from '@/src/features/input-translation/content/inputBox';

function keyEvent(key: string, code: string, shiftKey = false): KeyboardEvent {
    return { key, code, shiftKey } as KeyboardEvent;
}

function fakeElement(tagName: string, attributes: Record<string, string> = {}): HTMLElement {
    return {
        tagName,
        getAttribute(name: string) {
            return attributes[name] ?? null;
        },
        isContentEditable: false,
        value: '',
        textContent: '',
        innerText: '',
        type: 'text',
    } as unknown as HTMLElement;
}

describe('输入框快捷键', () => {
    it('兼容浏览器的 Space、Equal 和 Minus 按键值', () => {
        expect(matchesInputBoxTrigger(keyEvent(' ', 'Space'), 'triple_space')).toBe(true);
        expect(matchesInputBoxTrigger(keyEvent('x', 'KeyX'), 'triple_space')).toBe(false);
        expect(matchesInputBoxTrigger(keyEvent('=', 'Equal'), 'triple_equal')).toBe(true);
        expect(matchesInputBoxTrigger(keyEvent('+', 'Equal', true), 'triple_equal')).toBe(false);
        expect(matchesInputBoxTrigger(keyEvent('-', 'Minus'), 'triple_dash')).toBe(true);
        expect(matchesInputBoxTrigger(keyEvent('_', 'Minus', true), 'triple_dash')).toBe(false);
    });

    it('识别 plaintext-only 可编辑区域并跳过只读输入框', () => {
        expect(isInputElement(null)).toBe(false);
        expect(isInputElement({ ...fakeElement('INPUT'), disabled: true } as unknown as HTMLElement)).toBe(false);
        expect(isInputElement(fakeElement('DIV', { contenteditable: 'plaintext-only' }))).toBe(true);
        expect(isInputElement(fakeElement('INPUT'))).toBe(true);
        expect(isInputElement({ ...fakeElement('INPUT'), type: 'button' } as unknown as HTMLElement)).toBe(false);
        expect(isInputElement({ ...fakeElement('TEXTAREA'), readOnly: true } as unknown as HTMLElement)).toBe(false);
        expect(isInputElement(fakeElement('DIV'))).toBe(false);
    });

    it('能穿透开放 Shadow DOM 获取真实焦点', () => {
        const inner = fakeElement('INPUT');
        const host = {
            ...fakeElement('DIV'),
            shadowRoot: { activeElement: inner },
        } as unknown as Element;

        expect(getDeepActiveElement({ activeElement: host } as Document)).toBe(inner);
    });

    it('清理触发符号后保留真实输入内容', () => {
        expect(removeTriggerSymbols('Hello   ', 'triple_space')).toBe('Hello');
        expect(removeTriggerSymbols('Hello===', 'triple_equal')).toBe('Hello');
        expect(removeTriggerSymbols('Hello---', 'triple_dash')).toBe('Hello');
        expect(removeTriggerSymbols('Hello', 'ctrl_enter')).toBe('Hello');
        expect(getInputBoxText({ ...fakeElement('DIV'), innerText: ' Hello world ' } as unknown as HTMLElement)).toBe('Hello world');
        expect(getInputBoxText({ ...fakeElement('DIV'), textContent: ' Text fallback ' } as unknown as HTMLElement)).toBe('Text fallback');
        expect(getInputBoxText(fakeElement('DIV'))).toBe('');
    });

    it('用原始值快照检测翻译期间的用户编辑', () => {
        const input = { ...fakeElement('INPUT'), value: 'Hello  ' } as unknown as HTMLElement;
        expect(getInputBoxValueSnapshot(input)).toBe('Hello  ');

        const contentEditable = {
            ...fakeElement('DIV', { contenteditable: 'true' }),
            innerText: ' Hello\n',
        } as unknown as HTMLElement;
        expect(getInputBoxValueSnapshot(contentEditable)).toBe(' Hello\n');
        expect(getInputBoxValueSnapshot({ ...fakeElement('DIV'), textContent: 'raw text' } as unknown as HTMLElement)).toBe('raw text');
        expect(getInputBoxValueSnapshot(fakeElement('DIV'))).toBe('');
    });

    it('禁用后即使恢复启用，旧 feature signal 的结果仍不可落地', () => {
        const controller = new AbortController();
        controller.abort();

        expect(canCommitInputBoxTranslation({
            signal: controller.signal,
            expectedValue: 'Hello',
            currentValue: 'Hello',
            expectedConfigGeneration: 0,
            currentConfigGeneration: 0,
            isEnabled: true,
            isSiteDisabled: false,
        })).toBe(false);
    });

    it('用户在请求期间编辑输入框时拒绝覆盖新内容', () => {
        const controller = new AbortController();

        expect(canCommitInputBoxTranslation({
            signal: controller.signal,
            expectedValue: 'Hello',
            currentValue: 'Hello!',
            expectedConfigGeneration: 0,
            currentConfigGeneration: 0,
            isEnabled: true,
            isSiteDisabled: false,
        })).toBe(false);
        expect(canCommitInputBoxTranslation({
            signal: controller.signal,
            expectedValue: 'Hello',
            currentValue: 'Hello',
            expectedConfigGeneration: 0,
            currentConfigGeneration: 0,
            isEnabled: true,
            isSiteDisabled: false,
        })).toBe(true);
    });

    it('输入翻译关闭后快速恢复也会永久作废旧配置 generation', () => {
        const controller = new AbortController();

        expect(canCommitInputBoxTranslation({
            signal: controller.signal,
            expectedValue: 'Hello',
            currentValue: 'Hello',
            expectedConfigGeneration: 2,
            currentConfigGeneration: 3,
            // 模拟关闭后已经快速恢复，当前看起来又是 enabled。
            isEnabled: true,
            isSiteDisabled: false,
        })).toBe(false);
    });
});
