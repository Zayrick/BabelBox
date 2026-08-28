import {afterEach, describe, expect, it, vi} from 'vitest';
import {detectlang} from '@/src/core/language/detect';
import {throttle} from '@/src/shared/function/throttle';
import {getCenterPoint} from '@/src/shared/geometry/touch';

describe('语义化公共工具', () => {
    afterEach(() => vi.restoreAllMocks());

    it('节流函数保留 this/参数，并在时间窗内拒绝同步重入', () => {
        const now = vi.spyOn(Date, 'now')
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_099)
            .mockReturnValueOnce(1_100);
        const calls: Array<{owner: string; value: number}> = [];
        let throttled!: (this: {owner: string}, value: number) => void;
        throttled = throttle(function (this: {owner: string}, value: number) {
            calls.push({owner: this.owner, value});
            if (value === 1) throttled.call(this, 2);
        }, 100);
        const receiver = {owner: 'content'};

        throttled.call(receiver, 1);
        throttled.call(receiver, 3);
        throttled.call(receiver, 4);

        expect(calls).toEqual([
            {owner: 'content', value: 1},
            {owner: 'content', value: 4},
        ]);
        expect(now).toHaveBeenCalledTimes(4);
    });

    it.each([
        ['这是一个用于中文语言识别的完整句子。', 'zh-Hans'],
        ['This is a complete English sentence for language detection.', 'en'],
        ['これは言語判定のための十分に長い日本語の文章です。', 'ja'],
        ['이 문장은 언어 감지를 위한 충분히 긴 한국어 문장입니다.', 'ko'],
        ['Cette phrase française est suffisamment longue pour identifier la langue.', 'fr'],
        ['Это достаточно длинное русское предложение для определения языка.', 'ru'],
    ])('把常用 franc 结果映射到产品语言代码 %#', (value, expected) => {
        expect(detectlang(value)).toBe(expected);
    });

    it('未知或不确定语言保持 franc 原始代码', () => {
        expect(detectlang('12345')).toBe('und');
    });

    it('只为精确数量的非空触摸点计算中心', () => {
        const touches = {
            0: {clientX: 10, clientY: 20},
            1: {clientX: 30, clientY: 60},
            length: 2,
            item: () => null,
        };

        expect(getCenterPoint(touches, 2)).toEqual({x: 20, y: 40});
        expect(getCenterPoint(touches, 3)).toBeUndefined();
        expect(getCenterPoint({length: 0, item: () => null}, 0)).toBeUndefined();
    });
});
