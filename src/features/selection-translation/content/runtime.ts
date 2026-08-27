import SelectionTranslator from '@/src/features/selection-translation/ui/SelectionTranslator.vue';
import { config } from '@/src/services/config/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';

let selectionTranslatorInstance: any = null;
let selectionTranslatorUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<any> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;

/**
 * 挂载选词翻译组件
 */
export function mountSelectionTranslator(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;

  // 如果已存在实例或配置禁用了此功能，则不创建
  if (selectionTranslatorInstance || mountingPromise || config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled') {
    return mountingPromise;
  }

  if (!contentScriptContext) return;

  const requestId = ++mountRequestId;
  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-selection-translator-ui',
    hostId: 'fluent-read-selection-translator-container',
    component: SelectionTranslator,
    zIndex: 2_147_483_646,
    // The card exposes copy, speech, and translation actions. A closed root
    // prevents the host page from invoking them with synthetic DOM events.
    mode: 'closed',
  }).then((ui) => {
    if (requestId !== mountRequestId || config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled') {
      ui.remove();
      return null;
    }

    selectionTranslatorUi = ui;
    selectionTranslatorInstance = ui.mounted?.instance ?? null;
    return selectionTranslatorInstance;
  }).finally(() => {
    mountingPromise = null;
  });

  return mountingPromise;
}

/**
 * 卸载选词翻译组件
 */
export function unmountSelectionTranslator() {
  mountRequestId++;
  selectionTranslatorUi?.remove();
  selectionTranslatorUi = null;
  selectionTranslatorInstance = null;
}
