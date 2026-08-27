import TranslationProgressPanel from '@/src/features/full-page-translation/ui/TranslationProgressPanel.vue';
import {config} from '@/src/services/config/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';

let progressPanelInstance: unknown = null;
let progressPanelUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<unknown | null> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;
let mountRequested = false;

export function mountTranslationProgressPanel(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;
  mountRequested = config.translationProgressPanelEnabled === true;
  if (progressPanelUi || progressPanelInstance || mountingPromise || !mountRequested) {
    return mountingPromise;
  }
  if (!contentScriptContext) return;

  const requestId = ++mountRequestId;
  let retryAfterStaleMount = false;
  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-translation-progress-ui',
    // 保留旧版 host id，继续兼容既有 DOM 排除规则和自动化定位。
    hostId: 'fluent-read-translation-status-container',
    component: TranslationProgressPanel,
    zIndex: 2_147_483_645,
  }).then((ui) => {
    if (requestId !== mountRequestId || config.translationProgressPanelEnabled !== true) {
      retryAfterStaleMount = requestId !== mountRequestId;
      ui.remove();
      return null;
    }
    progressPanelUi = ui;
    progressPanelInstance = ui.mounted?.instance ?? null;
    return progressPanelInstance;
  }).catch((error) => {
    console.error('[FluentRead] 翻译进度面板挂载失败', error);
    return null;
  }).finally(() => {
    mountingPromise = null;
    // 设置页可能在 Shadow UI 首次挂载完成前快速关闭再开启。旧请求会按
    // requestId 自行移除，这里补发用户最后一次明确保留的挂载请求。
    if (retryAfterStaleMount && mountRequested && !progressPanelInstance) {
      void mountTranslationProgressPanel();
    }
  });

  return mountingPromise;
}

export function unmountTranslationProgressPanel(): void {
  mountRequested = false;
  mountRequestId += 1;
  progressPanelUi?.remove();
  progressPanelUi = null;
  progressPanelInstance = null;
}
