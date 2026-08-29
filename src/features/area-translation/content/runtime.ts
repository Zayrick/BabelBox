import AreaTranslator from '@/src/features/area-translation/ui/AreaTranslator.vue';
import { config } from '@/src/services/config/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';

let areaTranslatorInstance: any = null;
let areaTranslatorUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<any> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;

export function isAreaTranslatorMounted(): boolean {
  return Boolean(document.getElementById('babelbox-area-translator-container'));
}

export function mountAreaTranslator(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;
  if (areaTranslatorInstance || mountingPromise || config.selectionAreaEnabled !== true) return mountingPromise;
  if (!contentScriptContext) return;

  const requestId = ++mountRequestId;
  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'babelbox-area-translator-ui',
    hostId: 'babelbox-area-translator-container',
    component: AreaTranslator,
    zIndex: 2_147_483_647,
    // The translated bitmap may contain pixels captured from cross-origin
    // frames. Keep it out of the host page's script-visible shadow tree.
    mode: 'closed',
  }).then((ui) => {
    if (requestId !== mountRequestId || config.selectionAreaEnabled !== true) {
      ui.remove();
      return null;
    }
    areaTranslatorUi = ui;
    areaTranslatorInstance = ui.mounted?.instance ?? null;
    return areaTranslatorInstance;
  }).finally(() => {
    mountingPromise = null;
  });

  return mountingPromise;
}

export function unmountAreaTranslator(): void {
  mountRequestId += 1;
  areaTranslatorUi?.remove();
  areaTranslatorUi = null;
  areaTranslatorInstance = null;
}
