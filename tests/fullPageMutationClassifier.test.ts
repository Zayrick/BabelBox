import {describe, expect, it} from 'vitest';
import {classifyTranslationMutation} from '@/src/features/full-page-translation/content/mutationClassifier';

describe('全文翻译 mutation 分类', () => {
    it.each([
        ['childList', null, {channel: 'source', kind: 'structure'}],
        ['characterData', null, {channel: 'source', kind: 'text'}],
        ['attributes', 'aria-hidden', {
            channel: 'eligibility',
            kind: 'transient-presentation',
            attributeName: 'aria-hidden',
        }],
        ['attributes', 'inert', {
            channel: 'eligibility',
            kind: 'transient-presentation',
            attributeName: 'inert',
        }],
        ['attributes', 'class', {
            channel: 'eligibility',
            kind: 'layout-or-policy',
            attributeName: 'class',
        }],
        ['attributes', 'translate', {
            channel: 'eligibility',
            kind: 'durable-policy',
            attributeName: 'translate',
        }],
    ] as const)('classifies %s/%s without consulting current visibility', (type, attributeName, expected) => {
        expect(classifyTranslationMutation({type, attributeName})).toEqual(expected);
    });
});
