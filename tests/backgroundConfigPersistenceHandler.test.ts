import {describe, expect, it, vi} from 'vitest';
import {
    CONFIG_PERSIST_MESSAGE_TYPE,
    createConfigPersistenceHandler,
    type ConfigPersistenceDependencies,
} from '@/src/app/background/handlers/configPersistence';

interface TestConfig {
    marker: string;
    allowCredentialUpdates?: boolean;
}

function createDependencies(overrides: Partial<ConfigPersistenceDependencies<TestConfig>> = {}) {
    const dependencies: ConfigPersistenceDependencies<TestConfig> = {
        ready: Promise.resolve(),
        getCurrentConfig: vi.fn(() => ({marker: 'current'})),
        prepareConfigSaveRequest: vi.fn((incoming, _current, allowCredentialUpdates) => ({
            marker: String(incoming.marker),
            allowCredentialUpdates,
        })),
        saveConfig: vi.fn(async () => undefined),
        isExtensionUrl: (url) => url.startsWith('chrome-extension://extension-id/'),
        ...overrides,
    };
    return dependencies;
}

describe('background config persistence handler', () => {
    it('allows credential updates only for extension pages', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        await handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'options'},
            clientId: 'options',
            sequence: 1,
        }, {sender: {url: 'chrome-extension://extension-id/options.html'}});
        await handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'content'},
            clientId: 'content',
            sequence: 1,
        }, {sender: {url: 'https://example.com/article'}});

        expect(dependencies.prepareConfigSaveRequest).toHaveBeenNthCalledWith(
            1, {marker: 'options'}, {marker: 'current'}, true,
        );
        expect(dependencies.prepareConfigSaveRequest).toHaveBeenNthCalledWith(
            2, {marker: 'content'}, {marker: 'current'}, false,
        );
        expect(dependencies.saveConfig).toHaveBeenCalledTimes(2);
    });

    it('persists only the latest queued sequence for one client', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        const oldSave = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'old'},
            clientId: 'popup',
            sequence: 1,
        }, {});
        const newSave = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'new'},
            clientId: 'popup',
            sequence: 2,
        }, {});

        await expect(Promise.all([oldSave, newSave])).resolves.toEqual([{success: true}, {success: true}]);
        expect(dependencies.saveConfig).toHaveBeenCalledOnce();
        expect(dependencies.saveConfig).toHaveBeenCalledWith(
            {marker: 'new', allowCredentialUpdates: false},
            {recordHistory: true},
        );

        await handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'stale'},
            clientId: 'popup',
            sequence: 1,
        }, {});
        expect(dependencies.saveConfig).toHaveBeenCalledOnce();
    });

    it('continues the queue after a save failure', async () => {
        const saveConfig = vi.fn(async (config: TestConfig) => {
            if (config.marker === 'first') throw new Error('first failed');
        });
        const handler = createConfigPersistenceHandler(createDependencies({saveConfig}));

        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'first'},
            clientId: 'first-client',
            sequence: 1,
        }, {})).rejects.toThrow('first failed');
        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'second'},
            clientId: 'second-client',
            sequence: 1,
        }, {})).resolves.toEqual({success: true});
        expect(saveConfig).toHaveBeenCalledTimes(2);
    });

    it.each([
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, clientId: 'client', sequence: 1}, 'config'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, sequence: 1}, 'clientId'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, clientId: 'client', sequence: 0}, 'sequence'],
    ])('rejects malformed messages %#', async (message, field) => {
        const handler = createConfigPersistenceHandler(createDependencies());
        await expect(handler.handle(message, {})).rejects.toThrow(field);
    });
});
