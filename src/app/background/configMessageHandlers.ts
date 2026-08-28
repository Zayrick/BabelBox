import {browser} from 'wxt/browser';
import {
    applyConfigHistoryAction,
    config,
    configReady,
    incrementConfigCount,
    prepareConfigSaveRequest,
    saveConfig,
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

export function createConfigBackgroundHandlers<TContext extends ConfigPersistenceContext>(): Array<BackgroundMessageHandler<TContext>> {
    let mutationQueue: Promise<unknown> = Promise.resolve();
    const mutate = <T>(mutation: () => Promise<T>): Promise<T> => {
        const result = mutationQueue.catch(() => undefined).then(mutation);
        mutationQueue = result.then(() => undefined, () => undefined);
        return result;
    };
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
            isExtensionUrl: (url) => url.startsWith(browser.runtime.getURL('/')),
        }),
    ] as Array<BackgroundMessageHandler<TContext>>;
}
