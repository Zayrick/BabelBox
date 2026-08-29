export {};

declare global {
    interface UserscriptXmlHttpResponse {
        finalUrl?: string;
        readyState?: number;
        response?: unknown;
        responseHeaders?: string;
        responseText?: string;
        status: number;
        statusText?: string;
    }

    interface UserscriptXmlHttpRequestDetails {
        method?: string;
        url: string;
        headers?: Record<string, string>;
        data?: unknown;
        responseType?: 'arraybuffer' | 'blob' | 'json' | 'text';
        anonymous?: boolean;
        timeout?: number;
        onload?: (response: UserscriptXmlHttpResponse) => void;
        onerror?: (response: UserscriptXmlHttpResponse) => void;
        onabort?: (response: UserscriptXmlHttpResponse) => void;
        ontimeout?: (response: UserscriptXmlHttpResponse) => void;
    }

    interface UserscriptXmlHttpRequestHandle {
        abort?: () => void;
    }

    var GM_getValue: undefined | (<T>(key: string, defaultValue?: T) => T | Promise<T>);
    var GM_setValue: undefined | ((key: string, value: unknown) => void | Promise<void>);
    var GM_deleteValue: undefined | ((key: string) => void | Promise<void>);
    var GM_listValues: undefined | (() => string[] | Promise<string[]>);
    var GM_xmlhttpRequest: undefined | ((details: UserscriptXmlHttpRequestDetails) => UserscriptXmlHttpRequestHandle | void);
    var GM_registerMenuCommand: undefined | ((label: string, listener: () => void) => unknown);
    var GM_addStyle: undefined | ((css: string) => unknown);
    var unsafeWindow: Window | undefined;
    var __BABELBOX_ICON_DATA__: string | undefined;
    var __babelboxUserscriptCss: string | undefined;
    var browser: any;
    var chrome: any;
}
