export interface EnsureContentFeatureMountedOptions {
    mount: () => unknown | PromiseLike<unknown>;
    isMounted: () => boolean;
    isStillDesired: () => boolean;
}

/**
 * 页面功能恢复时，新的激活可能先复用到刚被禁用的旧挂载 Promise。
 * 旧 Promise 结束后，如果当前激活仍需要该功能且宿主节点还没出现，就重试一次。
 * 每个具体挂载器仍然拥有自己的 requestId、DOM 宿主和清理逻辑。
 */
export async function ensureContentFeatureMounted(options: EnsureContentFeatureMountedOptions): Promise<void> {
    // 先执行功能自己的挂载逻辑，兼容已有的异步 UI mount。
    await options.mount();

    // 若激活已失效，或宿主已经挂上，则不做额外动作。
    if (!options.isStillDesired() || options.isMounted()) return;

    // 仅在“还需要但未挂载”的场景重试一次，避免无限循环。
    await options.mount();
}
