import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

const mocks = vi.hoisted(() => ({
  config: {animationMode: 'default', service: 'deepseek'},
  sendErrorMessage: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/core/config/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/core/config/catalog')>();
  return {
    ...actual,
    options: {...actual.options, services: [{value: 'deepseek', label: 'DeepSeek'}]},
  };
});
vi.mock('@/src/features/page-notice/public', () => ({sendErrorMessage: mocks.sendErrorMessage}));

import {
  insertFailedTip,
  insertLoadingSpinner,
  removeLoadingSpinner,
} from '@/src/features/full-page-translation/ui/translationIndicators';

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

beforeEach(() => {
  const {document, window} = parseHTML('<html><body><p id="target">Source</p></body></html>');
  Object.defineProperty(globalThis, 'document', {value: document, configurable: true});
  Object.defineProperty(globalThis, 'window', {value: window, configurable: true});
  mocks.config.animationMode = 'default';
  mocks.config.service = 'deepseek';
  mocks.sendErrorMessage.mockReset();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'document', {value: originalDocument, configurable: true});
  Object.defineProperty(globalThis, 'window', {value: originalWindow, configurable: true});
});

describe('全文翻译节点状态指示', () => {
  it('失败节点可查看经过归类的原因，并安全重试', () => {
    const target = document.getElementById('target')!;
    const retry = vi.fn();

    const wrapper = insertFailedTip(target, 'quota exceeded', retry);

    expect(target.classList.contains('fluent-read-failure')).toBe(true);
    expect(wrapper.getAttribute('data-fr-translation-owned')).toBe('true');
    expect(wrapper.querySelectorAll('svg')).toHaveLength(2);
    wrapper.querySelector<HTMLElement>('.fluent-read-reason')!.click();
    expect(mocks.sendErrorMessage).toHaveBeenCalledWith(
      '你的请求频率过高，被【DeepSeek】拒绝了，请稍后再试吧~',
    );

    wrapper.querySelector<HTMLElement>('.fluent-read-retry')!.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(wrapper.isConnected).toBe(false);
    expect(target.classList.contains('fluent-read-failure')).toBe(false);
  });

  it('加载指示区分缓存命中，并尊重动画配置', async () => {
    const target = document.getElementById('target')!;
    const cached = insertLoadingSpinner(target, true);
    await Promise.resolve();

    expect(cached.getAttribute('data-fr-translation-owned')).toBe('true');
    expect(cached.dataset.animationMode).toBe('default');
    expect(cached.style.getPropertyValue('border-top')).toBe('3px solid green');
    expect(cached.classList.contains('static')).toBe(false);

    mocks.config.animationMode = 'static';
    const staticSpinner = insertLoadingSpinner(target);
    await Promise.resolve();
    expect(staticSpinner.style.getPropertyValue('border-top')).not.toBe('3px solid green');
    expect(staticSpinner.dataset.animationMode).toBe('static');
    expect(staticSpinner.classList.contains('static')).toBe(true);

    mocks.config.animationMode = 'shimmer';
    const shimmer = insertLoadingSpinner(target, false, 'Source');
    await Promise.resolve();
    expect(shimmer.dataset.animationMode).toBe('shimmer');
    expect(target.getAttribute('data-fr-translation-shimmer')).toBe('true');

    removeLoadingSpinner(target, shimmer);
    expect(shimmer.isConnected).toBe(false);
    expect(target.hasAttribute('data-fr-translation-shimmer')).toBe(false);
  });
});
