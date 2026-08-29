import {browser} from 'wxt/browser';
import {CONTEXT_MENU_IDS} from '@/src/core/config/constants';
import {getFullPageContextMenuPresentation} from '@/src/core/site-rules/domain';
import {config, configReady, subscribeConfig} from '@/src/services/config/store';
import {isBrowserTabId, type TabTranslationState, TabTranslationStateStore} from './tabTranslationState';

interface BrowserTabSummary {
    id?: number;
}

interface FullPageStateResponse {
    status?: string;
    isTranslated?: boolean;
    isSiteDisabled?: boolean;
}

export interface BackgroundContextMenuRuntime {
    readonly isSupported: boolean;
    update(tabId: number): Promise<void>;
}

/**
 * 组装右键菜单与标签页生命周期。
 *
 * 该模块只保存 worker 瞬时状态；页面是否已翻译仍以 content script 的回复为真值。
 */
export function installBackgroundContextMenus(
    tabTranslationStates: TabTranslationStateStore,
): BackgroundContextMenuRuntime {
    const isSupported = !!browser.contextMenus;
    let contextMenusReady = false;
    let contextMenuEnabled = true;
    let contextMenuSyncQueue: Promise<void> = Promise.resolve();

    const readTabTranslationState = async (tabId: number, force = false): Promise<TabTranslationState> => {
        if (!force && tabTranslationStates.hasCompleteState(tabId)) return tabTranslationStates.get(tabId);

        try {
            const response = await browser.tabs.sendMessage(tabId, {
                type: 'getFullPageTranslationState',
            }) as FullPageStateResponse | undefined;
            if (response?.status === 'success') {
                return tabTranslationStates.set(tabId, {
                    isTranslated: response.isTranslated === true,
                    isSiteDisabled: response.isSiteDisabled === true,
                });
            }
        } catch {
            // 浏览器内部页或尚未注入内容脚本的页面无法查询，沿用当前 worker 的安全默认值。
        }

        return tabTranslationStates.set(tabId, tabTranslationStates.get(tabId));
    };

    const update = async (tabId: number): Promise<void> => {
        if (!isSupported || !contextMenusReady) return;
        // contextMenus.update 修改全局菜单项；后台标签页不能覆盖当前活动页的标题。
        const activeTabs = await browser.tabs.query({active: true, lastFocusedWindow: true}) as BrowserTabSummary[];
        if (!activeTabs.some((tab) => tab.id === tabId)) return;

        const state = await readTabTranslationState(tabId, true);
        const presentation = getFullPageContextMenuPresentation(state.isTranslated, state.isSiteDisabled);
        try {
            await browser.contextMenus.update(CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE, presentation);
        } catch (error) {
            console.error('Failed to update context menu:', error);
        }
    };

    const sync = (): Promise<void> => {
        const requestedEnabled = contextMenuEnabled;
        contextMenuSyncQueue = contextMenuSyncQueue
            .catch(() => undefined)
            .then(async () => {
                if (requestedEnabled !== contextMenuEnabled) return;
                contextMenusReady = false;
                await browser.contextMenus.removeAll();
                if (!requestedEnabled || requestedEnabled !== contextMenuEnabled) return;

                await browser.contextMenus.create({
                    id: CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE,
                    title: '翻译机翻译',
                    contexts: ['page', 'selection'],
                });
                if (requestedEnabled !== contextMenuEnabled) {
                    await browser.contextMenus.removeAll();
                    return;
                }

                contextMenusReady = true;
                const activeTabs = await browser.tabs.query({active: true, lastFocusedWindow: true}) as BrowserTabSummary[];
                const activeTab = activeTabs.find((tab) => typeof tab.id === 'number');
                if (activeTab?.id !== undefined) await update(activeTab.id);
            })
            .catch((error) => {
                contextMenusReady = false;
                console.error('Error syncing context menu:', error);
            });
        return contextMenuSyncQueue;
    };

    if (!isSupported) {
        console.log('不支持右键菜单');
    } else {
        void configReady.then(() => {
            contextMenuEnabled = config.contextMenuEnabled !== false;
            void sync();
            subscribeConfig((nextConfig) => {
                const nextEnabled = nextConfig.contextMenuEnabled !== false;
                if (nextEnabled === contextMenuEnabled) return;
                contextMenuEnabled = nextEnabled;
                void sync();
            });
        });

        browser.contextMenus.onClicked.addListener((info: any, tab: any) => {
            if (!contextMenuEnabled
                || info.menuItemId !== CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE
                || !isBrowserTabId(tab?.id)) return;

            void (async () => {
                try {
                    const state = await readTabTranslationState(tab.id, true);
                    if (state.isSiteDisabled) {
                        await update(tab.id);
                        return;
                    }
                    const response = await browser.tabs.sendMessage(tab.id, {
                        type: 'contextMenuTranslate',
                        action: state.isTranslated ? 'restore' : 'fullPage',
                    }) as FullPageStateResponse | undefined;
                    if (response?.status !== 'success') return;
                    tabTranslationStates.setTranslated(
                        tab.id,
                        typeof response.isTranslated === 'boolean'
                            ? response.isTranslated
                            : !state.isTranslated,
                    );
                    await update(tab.id);
                } catch (error) {
                    console.error('Failed to send message to content script:', error);
                }
            })();
        });
    }

    browser.tabs.onActivated.addListener((activeInfo: any) => {
        if (isSupported) void update(activeInfo.tabId);
    });
    browser.tabs.onUpdated.addListener((tabId: any, changeInfo: any) => {
        if (changeInfo.status !== 'loading') return;
        tabTranslationStates.reset(tabId);
        if (isSupported) void update(tabId);
    });
    browser.tabs.onRemoved.addListener((tabId: any) => tabTranslationStates.delete(tabId));

    return {isSupported, update};
}
