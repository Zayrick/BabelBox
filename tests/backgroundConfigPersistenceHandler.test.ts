import {describe, expect, it, vi} from 'vitest';
import {
    CONFIG_PERSIST_MESSAGE_TYPE,
    createConfigPersistenceHandler,
} from '@/src/app/background/handlers/configPersistence';

describe('background config persistence handler', () => {
    it('persists the page patch without the stale translation count', async () => {
        const persistPatch = vi.fn(async () => undefined);
        const handler = createConfigPersistenceHandler(persistPatch);

        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            patch: {to: 'ja', count: 1},
        }, {sender: {url: 'https://example.com/article'}})).resolves.toEqual({success: true});

        expect(persistPatch).toHaveBeenCalledWith({to: 'ja'});
    });

    it('rejects messages without a patch object', async () => {
        const persistPatch = vi.fn(async () => undefined);
        const handler = createConfigPersistenceHandler(persistPatch);

        await expect(handler.handle({type: CONFIG_PERSIST_MESSAGE_TYPE, patch: []}, {}))
            .rejects.toThrow(TypeError);
        expect(persistPatch).not.toHaveBeenCalled();
    });
});
