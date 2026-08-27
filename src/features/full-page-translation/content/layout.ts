import {
    ensureTranslationTruncationLayout as ensureStateTranslationTruncationLayout,
} from "@/src/features/full-page-translation/content/state";

/**
 * 全文翻译布局出口。
 *
 * Step 1: runtime/renderer 只依赖 content/layout 这个稳定命名。
 * Step 2: 现阶段实际租约状态仍由 state 模块持有，后续可继续从 state 拆出。
 */
export function ensureTranslationTruncationLayout(owner: HTMLElement): boolean {
    return ensureStateTranslationTruncationLayout(owner);
}
