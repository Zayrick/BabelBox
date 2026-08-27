/** 浏览器 tab/window id 可以为 0；只接受非负安全整数。 */
export function isBrowserTabId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
