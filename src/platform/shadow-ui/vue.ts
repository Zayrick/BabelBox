import { createApp, type App as VueApp, type Component } from 'vue';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from 'wxt/utils/content-script-ui/shadow-root';

export interface VueShadowMount {
  app: VueApp;
  instance: unknown;
}

export interface VueShadowUiOptions {
  name: string;
  hostId: string;
  component: Component;
  props?: Record<string, unknown>;
  zIndex?: number;
  mode?: 'open' | 'closed';
}

const SHADOW_FOUNDATION = `
  :host {
    all: initial !important;
    display: block !important;
    position: relative !important;
    width: 0 !important;
    height: 0 !important;
    overflow: visible !important;
    contain: none !important;
    color-scheme: light dark;
  }

  html,
  body {
    width: 0 !important;
    height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;

/**
 * 把 Vue 组件挂载到隔离的 Shadow DOM。
 *
 * Step 1: WXT 负责 host 的生命周期和内容脚本失效清理。
 * Step 2: 这里统一 Vue 的 mount/unmount，避免每个 feature 重复维护 glue。
 * Step 3: 显式的 host 基础样式阻断宿主页的继承和裁剪影响。
 */
export async function createVueShadowUi(
  ctx: ContentScriptContext,
  options: VueShadowUiOptions,
): Promise<ShadowRootContentScriptUi<VueShadowMount>> {
  const ui = await createShadowRootUi<VueShadowMount>(ctx, {
    name: options.name,
    position: 'overlay',
    alignment: 'top-left',
    zIndex: options.zIndex ?? 2_147_483_647,
    mode: options.mode ?? 'open',
    inheritStyles: false,
    isolateEvents: ['keydown', 'keyup', 'keypress'],
    css: SHADOW_FOUNDATION,
    onMount(container) {
      const app = createApp(options.component, options.props ?? {});
      const instance = app.mount(container);
      return { app, instance };
    },
    onRemove(mounted) {
      mounted?.app.unmount();
    },
  });

  ui.shadowHost.id = options.hostId;
  ui.shadowHost.setAttribute('data-fluent-read-ui', options.name);
  ui.mount();
  return ui;
}
