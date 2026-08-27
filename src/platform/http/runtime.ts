/**
 * 可按运行环境替换的 HTTP transport。
 *
 * 浏览器扩展默认使用原生 Fetch；userscript 等运行环境可以在 provider 请求前
 * 注入兼容 transport，从而复用同一套 provider adapter，而不改变扩展网络边界。
 */
export type RuntimeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const nativeFetch: RuntimeFetch = (input, init) => globalThis.fetch(input, init);
let activeFetch: RuntimeFetch = nativeFetch;

export function setRuntimeFetch(nextFetch?: RuntimeFetch): void {
    activeFetch = nextFetch || nativeFetch;
}

export function runtimeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return activeFetch(input, init);
}
