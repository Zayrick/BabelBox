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
    // host id 同时属于全文翻译的扩展 DOM 排除规则。
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
    // 挂载期间再次开启时，requestId 会废弃已在进行的挂载，
    // 这里执行最后一次保留请求。
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
