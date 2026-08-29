import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    disableFloatingBall: false,
    floatingBallPosition: '' as '' | 'left' | 'right',
    translationProgressPanelEnabled: true,
  },
  createVueShadowUi: vi.fn(),
  requestConfigSave: vi.fn(),
  sendMessage: vi.fn(),
  autoTranslateEnglishPage: vi.fn(),
  isFullPageTranslationActive: vi.fn(),
  restoreOriginalContent: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({
  config: mocks.config,
  requestConfigSave: mocks.requestConfigSave,
}));
vi.mock('@/src/platform/shadow-ui', () => ({createVueShadowUi: mocks.createVueShadowUi}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      getURL: (path: string) => `chrome-extension://fixture${path}`,
      sendMessage: mocks.sendMessage,
    },
  },
}));
vi.mock('@/src/features/full-page-translation/public', () => ({
  autoTranslateEnglishPage: mocks.autoTranslateEnglishPage,
  isFullPageTranslationActive: mocks.isFullPageTranslationActive,
  restoreOriginalContent: mocks.restoreOriginalContent,
}));
vi.mock('@/src/features/floating-ball/ui/FloatingBall.vue', () => ({default: {name: 'FloatingBall'}}));
vi.mock('@/src/features/full-page-translation/ui/TranslationProgressPanel.vue', () => ({
  default: {name: 'TranslationProgressPanel'},
}));

interface MockUi {
  mounted?: {instance?: unknown};
  remove: ReturnType<typeof vi.fn>;
}

function ui(instance: unknown = {mounted: true}): MockUi {
  return {mounted: {instance}, remove: vi.fn()};
}

function pendingUi(): {promise: Promise<MockUi>; resolve: (value: MockUi) => void} {
  let resolve!: (value: MockUi) => void;
  return {
    promise: new Promise<MockUi>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

beforeEach(() => {
  vi.resetModules();
  Object.assign(mocks.config, {
    disableFloatingBall: false,
    floatingBallPosition: '',
    translationProgressPanelEnabled: true,
  });
  for (const mock of [
    mocks.createVueShadowUi,
    mocks.requestConfigSave,
    mocks.sendMessage,
    mocks.autoTranslateEnglishPage,
    mocks.isFullPageTranslationActive,
    mocks.restoreOriginalContent,
  ]) mock.mockReset();
  mocks.requestConfigSave.mockResolvedValue(undefined);
  mocks.sendMessage.mockResolvedValue({success: true});
  mocks.autoTranslateEnglishPage.mockResolvedValue(undefined);
  mocks.isFullPageTranslationActive.mockReturnValue(false);
});

describe('悬浮球 content runtime', () => {
  it('在没有上下文或功能被禁用时不创建 UI', async () => {
    const runtime = await import('@/src/features/floating-ball/content/runtime');
    expect(runtime.mountFloatingBall()).toBeUndefined();
    mocks.config.disableFloatingBall = true;
    expect(runtime.mountFloatingBall({} as never)).toBeNull();
    expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    expect(runtime.toggleFloatingBallTranslation()).toBe(false);
  });

  it('通过关闭 Shadow DOM 组装交互，并在卸载时清理翻译状态', async () => {
    const toggleTranslation = vi.fn();
    const mountedUi = ui({toggleTranslation});
    mocks.createVueShadowUi.mockResolvedValue(mountedUi);
    const runtime = await import('@/src/features/floating-ball/content/runtime');
    const context = {name: 'content'} as never;

    await expect(runtime.mountFloatingBall(context)).resolves.toEqual({toggleTranslation});
    const [, options] = mocks.createVueShadowUi.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({
      name: 'babelbox-floating-ball-ui',
      hostId: 'babelbox-floating-ball-container',
      mode: 'closed',
    }));
    expect(options.props).toEqual(expect.objectContaining({
      position: 'right',
      logoUrl: 'chrome-extension://fixture/icon/128.png',
      initialTranslating: false,
    }));
    expect(runtime.mountFloatingBall()).toBeNull();
    expect(runtime.toggleFloatingBallTranslation()).toBe(true);
    expect(toggleTranslation).toHaveBeenCalledOnce();

    options.props.onSettingsClick();
    options.props.onPositionChanged('left');
    await Promise.resolve();
    expect(mocks.sendMessage).toHaveBeenCalledWith({type: 'openOptionsPage'});
    expect(mocks.config.floatingBallPosition).toBe('left');
    expect(mocks.requestConfigSave).toHaveBeenCalledWith(mocks.config, expect.any(Function));

    mocks.isFullPageTranslationActive.mockReturnValueOnce(true);
    options.props.onTranslationToggle(true);
    expect(mocks.autoTranslateEnglishPage).not.toHaveBeenCalled();
    mocks.isFullPageTranslationActive.mockReturnValueOnce(false);
    options.props.onTranslationToggle(true);
    expect(mocks.autoTranslateEnglishPage).toHaveBeenCalledOnce();
    mocks.isFullPageTranslationActive.mockReturnValueOnce(true);
    options.props.onTranslationToggle(false);
    expect(mocks.restoreOriginalContent).toHaveBeenCalledOnce();

    mocks.isFullPageTranslationActive.mockReturnValueOnce(true);
    runtime.unmountFloatingBall();
    runtime.unmountFloatingBall();
    expect(mountedUi.remove).toHaveBeenCalledOnce();
    expect(mocks.restoreOriginalContent).toHaveBeenCalledTimes(2);
  });

  it('隔离设置、保存和挂载失败，并允许重试', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.createVueShadowUi
      .mockRejectedValueOnce(new Error('mount failed'))
      .mockResolvedValueOnce(ui({toggleTranslation: vi.fn()}));
    const runtime = await import('@/src/features/floating-ball/content/runtime');

    await expect(runtime.mountFloatingBall({} as never)).resolves.toBeNull();
    await expect(runtime.mountFloatingBall()).resolves.toEqual(expect.objectContaining({toggleTranslation: expect.any(Function)}));
    const [, options] = mocks.createVueShadowUi.mock.calls[1];

    mocks.sendMessage.mockRejectedValueOnce(new Error('settings failed'));
    mocks.requestConfigSave.mockRejectedValueOnce(new Error('save failed'));
    options.props.onSettingsClick();
    options.props.onPositionChanged('right');
    mocks.isFullPageTranslationActive.mockReturnValueOnce(false);
    options.props.onTranslationToggle(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith('[BabelBox] 悬浮球挂载失败', expect.any(Error));
    expect(consoleError).toHaveBeenCalledWith('[BabelBox] 打开设置页失败', expect.any(Error));
    expect(consoleError).toHaveBeenCalledWith('Failed to save config:', expect.any(Error));
    runtime.unmountFloatingBall();
    consoleError.mockRestore();
  });

  it('丢弃卸载或禁用后才到达的挂载结果', async () => {
    const pending = pendingUi();
    const staleUi = ui({toggleTranslation: vi.fn()});
    mocks.createVueShadowUi.mockReturnValue(pending.promise);
    const runtime = await import('@/src/features/floating-ball/content/runtime');

    const request = runtime.mountFloatingBall({} as never)!;
    expect(runtime.mountFloatingBall()).toBe(request);
    runtime.unmountFloatingBall();
    mocks.config.disableFloatingBall = true;
    pending.resolve(staleUi);

    await expect(request).resolves.toBeNull();
    expect(staleUi.remove).toHaveBeenCalledOnce();
  });

  it('没有 exposed instance 时仍防止重复挂载并可完整清理', async () => {
    const mountedUi = {remove: vi.fn()};
    mocks.createVueShadowUi.mockResolvedValue(mountedUi);
    const runtime = await import('@/src/features/floating-ball/content/runtime');

    await expect(runtime.mountFloatingBall({} as never)).resolves.toBeNull();
    expect(runtime.mountFloatingBall()).toBeNull();
    expect(mocks.createVueShadowUi).toHaveBeenCalledOnce();
    runtime.unmountFloatingBall();
    expect(mountedUi.remove).toHaveBeenCalledOnce();
  });
});

describe('全文翻译进度面板 content runtime', () => {
  it('只在开启且获得上下文后挂载，卸载幂等', async () => {
    const runtime = await import('@/src/features/full-page-translation/content/progressPanel');
    expect(runtime.mountTranslationProgressPanel()).toBeUndefined();
    mocks.config.translationProgressPanelEnabled = false;
    expect(runtime.mountTranslationProgressPanel({} as never)).toBeNull();
    expect(mocks.createVueShadowUi).not.toHaveBeenCalled();

    mocks.config.translationProgressPanelEnabled = true;
    const mountedUi = ui({panel: true});
    mocks.createVueShadowUi.mockResolvedValue(mountedUi);
    await expect(runtime.mountTranslationProgressPanel()).resolves.toEqual({panel: true});
    expect(mocks.createVueShadowUi).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      name: 'babelbox-translation-progress-ui',
      hostId: 'babelbox-translation-status-container',
      zIndex: 2_147_483_645,
    }));
    expect(runtime.mountTranslationProgressPanel()).toBeNull();
    runtime.unmountTranslationProgressPanel();
    runtime.unmountTranslationProgressPanel();
    expect(mountedUi.remove).toHaveBeenCalledOnce();
  });

  it('挂载失败时降级为无面板并允许重试', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.createVueShadowUi
      .mockRejectedValueOnce(new Error('panel failed'))
      .mockResolvedValueOnce(ui({panel: true}));
    const runtime = await import('@/src/features/full-page-translation/content/progressPanel');

    await expect(runtime.mountTranslationProgressPanel({} as never)).resolves.toBeNull();
    await expect(runtime.mountTranslationProgressPanel()).resolves.toEqual({panel: true});
    expect(consoleError).toHaveBeenCalledWith('[BabelBox] 翻译进度面板挂载失败', expect.any(Error));
    runtime.unmountTranslationProgressPanel();
    consoleError.mockRestore();
  });

  it('关闭功能时移除迟到面板，且不重试', async () => {
    const pending = pendingUi();
    const staleUi = ui({panel: true});
    mocks.createVueShadowUi.mockReturnValue(pending.promise);
    const runtime = await import('@/src/features/full-page-translation/content/progressPanel');

    const request = runtime.mountTranslationProgressPanel({} as never)!;
    mocks.config.translationProgressPanelEnabled = false;
    pending.resolve(staleUi);

    await expect(request).resolves.toBeNull();
    expect(staleUi.remove).toHaveBeenCalledOnce();
    expect(mocks.createVueShadowUi).toHaveBeenCalledOnce();
  });

  it('快速关闭再开启时丢弃旧请求并补发最终挂载', async () => {
    const pending = pendingUi();
    const staleUi = ui({panel: 'stale'});
    const currentUi = ui({panel: 'current'});
    mocks.createVueShadowUi.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(currentUi);
    const runtime = await import('@/src/features/full-page-translation/content/progressPanel');

    const request = runtime.mountTranslationProgressPanel({} as never)!;
    runtime.unmountTranslationProgressPanel();
    mocks.config.translationProgressPanelEnabled = true;
    expect(runtime.mountTranslationProgressPanel()).toBe(request);
    pending.resolve(staleUi);
    await expect(request).resolves.toBeNull();
    await vi.waitFor(() => expect(mocks.createVueShadowUi).toHaveBeenCalledTimes(2));

    expect(staleUi.remove).toHaveBeenCalledOnce();
    runtime.unmountTranslationProgressPanel();
    expect(currentUi.remove).toHaveBeenCalledOnce();
  });

  it('面板没有 exposed instance 时仍保持单例', async () => {
    const mountedUi = {remove: vi.fn()};
    mocks.createVueShadowUi.mockResolvedValue(mountedUi);
    const runtime = await import('@/src/features/full-page-translation/content/progressPanel');

    await expect(runtime.mountTranslationProgressPanel({} as never)).resolves.toBeNull();
    expect(runtime.mountTranslationProgressPanel()).toBeNull();
    expect(mocks.createVueShadowUi).toHaveBeenCalledOnce();
    runtime.unmountTranslationProgressPanel();
    expect(mountedUi.remove).toHaveBeenCalledOnce();
  });
});
