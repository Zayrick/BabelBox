export const FULL_PAGE_TRANSLATION_STATE_MESSAGE_TYPE = 'fullPageTranslationState' as const;
export const SITE_EXTENSION_DISABLED_STATE_MESSAGE_TYPE = 'siteExtensionDisabledState' as const;

export interface FullPageBackgroundContext {
    sender?: {
        tab?: {
            id?: number;
        };
    };
}

export interface FullPageTranslationStateMessage {
    type: typeof FULL_PAGE_TRANSLATION_STATE_MESSAGE_TYPE;
    isTranslated?: unknown;
}

export interface SiteExtensionDisabledStateMessage {
    type: typeof SITE_EXTENSION_DISABLED_STATE_MESSAGE_TYPE;
    isDisabled?: unknown;
}

export type FullPageTranslationStateRuntimeMessage =
    | FullPageTranslationStateMessage
    | SiteExtensionDisabledStateMessage;

export interface FullPageTranslationStateStore {
    setTranslated(tabId: number, translated: boolean): unknown;
    setSiteDisabled(tabId: number, disabled: boolean): unknown;
}

export interface FullPageTranslationStateDependencies {
    readonly stateStore: FullPageTranslationStateStore;
    readonly isTabId: (value: unknown) => value is number;
    readonly onStateChanged: (tabId: number) => void;
}

export interface FullPageTranslationStateHandler<TMessage extends FullPageTranslationStateRuntimeMessage> {
    readonly type: TMessage['type'];
    handle(message: TMessage, context: FullPageBackgroundContext): {success: true};
}

function parseBoolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') throw new TypeError(`全文翻译状态 ${field} 必须是布尔值`);
    return value;
}

function senderTabId(
    context: FullPageBackgroundContext,
    isTabId: (value: unknown) => value is number,
): number | null {
    const tabId = context.sender?.tab?.id;
    return isTabId(tabId) ? tabId : null;
}

/** 创建全文翻译/站点禁用状态 handler；MV3 瞬时状态存储由 app 层注入。 */
export function createFullPageTranslationStateHandlers(
    dependencies: FullPageTranslationStateDependencies,
): [
    FullPageTranslationStateHandler<FullPageTranslationStateMessage>,
    FullPageTranslationStateHandler<SiteExtensionDisabledStateMessage>,
] {
    return [
        {
            type: FULL_PAGE_TRANSLATION_STATE_MESSAGE_TYPE,
            handle(message, context) {
                const isTranslated = parseBoolean(message.isTranslated, 'isTranslated');
                const tabId = senderTabId(context, dependencies.isTabId);
                if (tabId !== null) {
                    dependencies.stateStore.setTranslated(tabId, isTranslated);
                    dependencies.onStateChanged(tabId);
                }
                return {success: true};
            },
        },
        {
            type: SITE_EXTENSION_DISABLED_STATE_MESSAGE_TYPE,
            handle(message, context) {
                const isDisabled = parseBoolean(message.isDisabled, 'isDisabled');
                const tabId = senderTabId(context, dependencies.isTabId);
                if (tabId !== null) {
                    dependencies.stateStore.setSiteDisabled(tabId, isDisabled);
                    dependencies.onStateChanged(tabId);
                }
                return {success: true};
            },
        },
    ];
}
