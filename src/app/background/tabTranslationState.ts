export {isBrowserTabId} from '@/src/platform/browser/ids';

export interface TabTranslationState {
    isTranslated: boolean;
    isSiteDisabled: boolean;
}

interface PartialTabTranslationState {
    isTranslated?: boolean;
    isSiteDisabled?: boolean;
}

/**
 * 保存后台 service worker 的标签页瞬时状态；持久真值仍由 content script 提供。
 */
export class TabTranslationStateStore {
    private readonly states = new Map<number, PartialTabTranslationState>();

    hasCompleteState(tabId: number): boolean {
        const state = this.states.get(tabId);
        return typeof state?.isTranslated === 'boolean'
            && typeof state.isSiteDisabled === 'boolean';
    }

    get(tabId: number): TabTranslationState {
        const state = this.states.get(tabId);
        return {
            isTranslated: state?.isTranslated === true,
            isSiteDisabled: state?.isSiteDisabled === true,
        };
    }

    set(tabId: number, state: TabTranslationState): TabTranslationState {
        const snapshot = {...state};
        this.states.set(tabId, snapshot);
        return snapshot;
    }

    setTranslated(tabId: number, isTranslated: boolean): TabTranslationState {
        const current = this.states.get(tabId) || {};
        current.isTranslated = isTranslated;
        this.states.set(tabId, current);
        return this.get(tabId);
    }

    setSiteDisabled(tabId: number, isSiteDisabled: boolean): TabTranslationState {
        const current = this.states.get(tabId) || {};
        current.isSiteDisabled = isSiteDisabled;
        if (isSiteDisabled) current.isTranslated = false;
        this.states.set(tabId, current);
        return this.get(tabId);
    }

    reset(tabId: number): TabTranslationState {
        return this.set(tabId, {isTranslated: false, isSiteDisabled: false});
    }

    delete(tabId: number): void {
        this.states.delete(tabId);
    }
}
