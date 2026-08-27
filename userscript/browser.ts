import {getStoredValue, setStoredValue} from './storage';

type RuntimeListener = (
    message: any,
    sender: any,
    sendResponse: (response?: any) => void,
) => unknown;
type PlatformMessageHandler = (message: any) => Promise<any>;

export const UNHANDLED_RUNTIME_MESSAGE = Symbol('unhandled-runtime-message');

const runtimeListeners = new Set<RuntimeListener>();
let platformMessageHandler: PlatformMessageHandler = async () => UNHANDLED_RUNTIME_MESSAGE;

export function setPlatformMessageHandler(handler: PlatformMessageHandler): void {
    platformMessageHandler = handler;
}

export async function dispatchContentMessage(message: any): Promise<any> {
    for (const listener of runtimeListeners) {
        let didRespond = false;
        let responseValue: any;
        const sendResponse = (value?: any) => {
            didRespond = true;
            responseValue = value;
        };
        const returned = listener(message, {tab: {id: 1, windowId: 1}, frameId: 0}, sendResponse);
        if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
            const value = await returned;
            if (value !== undefined) return value;
        }
        if (didRespond) return responseValue;
        if (returned === true) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (didRespond) return responseValue;
        }
    }
    return undefined;
}

function runtimeAssetUrl(path: string): string {
    if (/icon\/(?:32|48|64|128|256|512)\.png$/u.test(path)) {
        return globalThis.__FLUENTREAD_ICON_DATA__ || '';
    }
    return '';
}

const runtime = {
    async sendMessage(message: any): Promise<any> {
        const result = await platformMessageHandler(message);
        if (result !== UNHANDLED_RUNTIME_MESSAGE) return result;
        return dispatchContentMessage(message);
    },
    getURL: runtimeAssetUrl,
    async openOptionsPage(): Promise<void> {
        window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings'));
    },
    onMessage: {
        addListener(listener: RuntimeListener): void {
            runtimeListeners.add(listener);
        },
        removeListener(listener: RuntimeListener): void {
            runtimeListeners.delete(listener);
        },
        hasListener(listener: RuntimeListener): boolean {
            return runtimeListeners.has(listener);
        },
    },
};

export const browser = {
    runtime,
    tabs: {
        async query(): Promise<Array<{id: number; windowId: number; active: boolean}>> {
            return [{id: 1, windowId: 1, active: true}];
        },
        async sendMessage(_tabId: number, message: any): Promise<any> {
            return dispatchContentMessage(message);
        },
        async create({url}: {url?: string}): Promise<void> {
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        },
    },
    storage: {
        local: {
            async get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>> {
                if (typeof keys === 'string') return {[keys]: await getStoredValue(keys)};
                if (Array.isArray(keys)) {
                    return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await getStoredValue(key)])));
                }
                if (keys && typeof keys === 'object') {
                    return Object.fromEntries(await Promise.all(Object.entries(keys).map(async ([key, fallback]) => {
                        const value = await getStoredValue(key);
                        return [key, value ?? fallback];
                    })));
                }
                const names = typeof globalThis.GM_listValues === 'function'
                    ? await Promise.resolve(globalThis.GM_listValues())
                    : [];
                return Object.fromEntries(await Promise.all(names.map(async (key) => [key, await getStoredValue(key)])));
            },
            async set(values: Record<string, unknown>): Promise<void> {
                await Promise.all(Object.entries(values).map(([key, value]) => setStoredValue(key, value)));
            },
        },
    },
};

export const chrome = {
    runtime,
    storage: browser.storage,
};

export default browser;
