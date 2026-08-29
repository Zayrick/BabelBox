import {browser} from 'wxt/browser';
import {
    applyConfigHistoryAction,
    config,
    configReady,
    incrementConfigCount,
    prepareConfigSaveRequest,
    saveConfig,
    setCredentialStorageMode,
} from '@/src/services/config/store';
import {restoreConfigAutoBackup} from '@/src/services/config/autoBackupStore';
import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';
import {createConfigAutoBackupRestoreHandler} from './handlers/configAutoBackup';
import {createConfigCountIncrementHandler} from './handlers/configCount';
import {createConfigHistoryHandler} from './handlers/configHistory';
import {
    createConfigPersistenceHandler,
    type ConfigPersistenceContext,
} from './handlers/configPersistence';
import {createCredentialStorageModeHandler} from './handlers/credentialStorageMode';

export function createConfigBackgroundHandlers<TContext extends ConfigPersistenceContext>(): Array<BackgroundMessageHandler<TContext>> {
    let mutationQueue: Promise<unknown> = Promise.resolve();
    const mutate = <T>(mutation: () => Promise<T>): Promise<T> => {
        const result = mutationQueue.catch(() => undefined).then(mutation);
        mutationQueue = result.then(() => undefined, () => undefined);
        return result;
    };
    const isExtensionUrl = (url: string) => url.startsWith(browser.runtime.getURL('/'));
    return [
        createConfigCountIncrementHandler((delta) => mutate(() => incrementConfigCount(delta))),
        createConfigHistoryHandler((action, version) => (
            mutate(() => applyConfigHistoryAction(action, version))
        )),
        createConfigAutoBackupRestoreHandler((version) => (
            mutate(() => restoreConfigAutoBackup(version))
        )),
        createConfigPersistenceHandler({
            ready: configReady,
            getCurrentConfig: () => config,
            prepareConfigSaveRequest,
            saveConfig: (nextConfig, options) => mutate(() => saveConfig(nextConfig, options)),
            isExtensionUrl,
        }),
        createCredentialStorageModeHandler(
            (mode) => mutate(() => setCredentialStorageMode(mode)),
            isExtensionUrl,
        ),
    ] as Array<BackgroundMessageHandler<TContext>>;
}
