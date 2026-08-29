type ShadowRootUiOptions<T> = {
    name: string;
    position?: string;
    alignment?: string;
    zIndex?: number;
    mode?: ShadowRootMode;
    inheritStyles?: boolean;
    isolateEvents?: string[];
    css?: string;
    onMount(container: HTMLElement): T;
    onRemove?(mounted?: T): void;
};

export interface ShadowRootContentScriptUi<T> {
    shadowHost: HTMLElement;
    shadow: ShadowRoot;
    mounted?: T;
    mount(): void;
    remove(): void;
}

function installStyles(shadow: ShadowRoot, localCss = ''): void {
    const css = [globalThis.__babelboxUserscriptCss || '', localCss].filter(Boolean).join('\n');
    if (!css) return;
    const style = document.createElement('style');
    style.setAttribute('data-babelbox-userscript-styles', 'true');
    style.textContent = css;
    shadow.appendChild(style);
}

/** Minimal WXT-compatible Shadow UI host for the single-page userscript runtime. */
export async function createShadowRootUi<T>(
    _ctx: unknown,
    options: ShadowRootUiOptions<T>,
): Promise<ShadowRootContentScriptUi<T>> {
    const shadowHost = document.createElement('div');
    shadowHost.setAttribute('data-babelbox-userscript-host', options.name);
    shadowHost.style.cssText = [
        'all: initial !important',
        'position: fixed !important',
        'left: 0 !important',
        'top: 0 !important',
        'width: 0 !important',
        'height: 0 !important',
        'overflow: visible !important',
        'pointer-events: auto !important',
        `z-index: ${options.zIndex ?? 2_147_483_647} !important`,
    ].join(';');

    const shadow = shadowHost.attachShadow({mode: options.mode || 'open'});
    installStyles(shadow, options.css);
    const container = document.createElement('div');
    container.setAttribute('data-babelbox-userscript-container', options.name);
    container.style.cssText = 'all: initial; width: 0; height: 0; overflow: visible; pointer-events: auto;';
    shadow.appendChild(container);

    for (const eventName of options.isolateEvents || []) {
        shadow.addEventListener(eventName, (event) => event.stopPropagation(), true);
    }

    let isMounted = false;
    const ui: ShadowRootContentScriptUi<T> = {
        shadowHost,
        shadow,
        mount() {
            if (isMounted) return;
            isMounted = true;
            (document.documentElement || document.body).appendChild(shadowHost);
            ui.mounted = options.onMount(container);
        },
        remove() {
            if (!isMounted) return;
            isMounted = false;
            options.onRemove?.(ui.mounted);
            ui.mounted = undefined;
            shadowHost.remove();
        },
    };
    return ui;
}
