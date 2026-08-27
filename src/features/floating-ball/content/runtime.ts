import FloatingBall from '@/src/features/floating-ball/ui/FloatingBall.vue';
import {config, requestConfigSave} from '@/src/services/config/store';
import {browser} from 'wxt/browser';
import {
  autoTranslateEnglishPage,
  isFullPageTranslationActive,
  restoreOriginalContent,
} from '@/src/features/full-page-translation/public';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';

interface FloatingBallExposed {
  toggleTranslation: () => void;
}

let floatingBallInstance: FloatingBallExposed | null = null;
let floatingBallUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<FloatingBallExposed | null> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;

/** 创建并挂载悬浮球 */
export function mountFloatingBall(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;

  // 如果配置禁用了悬浮球或已存在实例，则不创建
  if (config.disableFloatingBall || floatingBallUi || floatingBallInstance || mountingPromise) {
    return mountingPromise;
  }

  if (!contentScriptContext) return;

  const ballPosition = config.floatingBallPosition || 'right';
  const requestId = ++mountRequestId;
  // 更新配置
  config.floatingBallPosition = ballPosition;

  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-floating-ball-ui',
    hostId: 'fluent-read-floating-ball-container',
    component: FloatingBall,
    props: {
      position: ballPosition,
      showMenu: true,
      logoUrl: browser.runtime.getURL('/icon/128.png'),
      initialTranslating: isFullPageTranslationActive(),
      onSettingsClick: () => {
        void browser.runtime.sendMessage({type: 'openOptionsPage'}).catch((error: unknown) => {
          console.error('[FluentRead] 打开设置页失败', error);
        });
      },
      // 添加位置变化事件监听
      onPositionChanged: (newPosition: 'left' | 'right') => {
        // 保存位置到配置
        config.floatingBallPosition = newPosition;

        // 保存配置到存储
        void requestConfigSave(
          config,
          browser.runtime.sendMessage.bind(browser.runtime),
        ).catch((error: unknown) => console.error('Failed to save config:', error));
      },
      // 添加翻译状态变化事件监听
      onTranslationToggle: (isTranslating: boolean) => {
        if (isTranslating === isFullPageTranslationActive()) return;

        if (isTranslating) {
          autoTranslateEnglishPage();
        } else {
          restoreOriginalContent();
        }
      },
    },
    // Host pages can dispatch synthetic clicks into an open shadow tree. Keep
    // translation, settings, and position controls behind a closed boundary.
    mode: 'closed',
  }).then((ui) => {
    if (requestId !== mountRequestId || config.disableFloatingBall) {
      ui.remove();
      return null;
    }

    floatingBallUi = ui;
    floatingBallInstance = (ui.mounted?.instance as FloatingBallExposed | null | undefined) ?? null;

    return floatingBallInstance;
  }).catch((error: unknown) => {
    console.error('[FluentRead] 悬浮球挂载失败', error);
    return null;
  }).finally(() => {
    mountingPromise = null;
  });

  return mountingPromise;
}

/**
 * Toggle through the isolated Vue instance instead of a DOM CustomEvent. Host
 * pages share the DOM event surface with content scripts and must not be able
 * to invoke extension actions.
 */
export function toggleFloatingBallTranslation(): boolean {
  if (!floatingBallInstance?.toggleTranslation) return false;
  floatingBallInstance.toggleTranslation();
  return true;
}

/**
 * 卸载悬浮球
 */
export function unmountFloatingBall() {
  mountRequestId++;
  if (floatingBallUi || floatingBallInstance) {
    if (isFullPageTranslationActive()) {
      restoreOriginalContent();
    }
    floatingBallUi?.remove();
    floatingBallUi = null;
    floatingBallInstance = null;
  }
}
