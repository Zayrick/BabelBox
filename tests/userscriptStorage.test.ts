import {afterEach, describe, expect, it} from 'vitest';
import {getStoredValue, removeStoredValue, setStoredValue} from '@/userscript/storage';

describe('userscript GM storage adapter', () => {
    afterEach(() => {
        globalThis.GM_getValue = undefined;
        globalThis.GM_setValue = undefined;
        globalThis.GM_deleteValue = undefined;
    });

    it('serializes objects for string-only GM storage implementations', async () => {
        const values = new Map<string, unknown>();
        globalThis.GM_getValue = ((key, fallback) => values.has(key) ? values.get(key) : fallback) as NonNullable<typeof globalThis.GM_getValue>;
        globalThis.GM_setValue = (key, value) => { values.set(key, value); };
        globalThis.GM_deleteValue = (key) => { values.delete(key); };

        await setStoredValue('local:config', {service: 'freeTranslation', on: true});
        expect(values.get('local:config')).toBe('{"service":"freeTranslation","on":true}');
        await expect(getStoredValue('local:config')).resolves.toEqual({service: 'freeTranslation', on: true});

        await removeStoredValue('local:config');
        await expect(getStoredValue('local:config')).resolves.toBeNull();
    });

    it('reads plain string values without treating them as JSON', async () => {
        globalThis.GM_getValue = ((key, fallback) => key === 'model' ? 'microsoft' : fallback) as NonNullable<typeof globalThis.GM_getValue>;
        await expect(getStoredValue('model')).resolves.toBe('microsoft');
    });
});
