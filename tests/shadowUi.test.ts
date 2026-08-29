import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  createShadowRootUi: vi.fn(),
}));

vi.mock('vue', () => ({createApp: mocks.createApp}));
vi.mock('wxt/utils/content-script-ui/shadow-root', () => ({
  createShadowRootUi: mocks.createShadowRootUi,
}));

import {createVueShadowUi} from '@/src/platform/shadow-ui';

function shadowUi() {
  const attributes = new Map<string, string>();
  const host = {
    id: '',
    setAttribute: vi.fn((name: string, value: string) => attributes.set(name, value)),
  };
  return {
    attributes,
    host,
    ui: {
      shadowHost: host,
      mount: vi.fn(),
    },
  };
}

beforeEach(() => {
  mocks.createApp.mockReset();
  mocks.createShadowRootUi.mockReset();
});

describe('Vue Shadow UI 平台适配器', () => {
  it('使用安全默认值挂载，并在 WXT 移除时卸载 Vue', async () => {
    const fixture = shadowUi();
    const instance = {kind: 'component'};
    const app = {mount: vi.fn(() => instance), unmount: vi.fn()};
    mocks.createApp.mockReturnValue(app);
    mocks.createShadowRootUi.mockResolvedValue(fixture.ui);
    const component = {name: 'Fixture'};

    const result = await createVueShadowUi({} as never, {
      name: 'fixture-ui',
      hostId: 'fixture-host',
      component,
    });

    const [, options] = mocks.createShadowRootUi.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({
      name: 'fixture-ui',
      position: 'overlay',
      alignment: 'top-left',
      zIndex: 2_147_483_647,
      mode: 'open',
      inheritStyles: false,
      isolateEvents: ['keydown', 'keyup', 'keypress'],
    }));
    expect(options.css).toContain(':host');

    const container = {nodeType: 1};
    const mounted = options.onMount(container);
    expect(mocks.createApp).toHaveBeenCalledWith(component, {});
    expect(app.mount).toHaveBeenCalledWith(container);
    expect(mounted).toEqual({app, instance});
    options.onRemove(mounted);
    options.onRemove(undefined);
    expect(app.unmount).toHaveBeenCalledOnce();

    expect(result).toBe(fixture.ui);
    expect(fixture.host.id).toBe('fixture-host');
    expect(fixture.attributes.get('data-babelbox-ui')).toBe('fixture-ui');
    expect(fixture.ui.mount).toHaveBeenCalledOnce();
  });

  it('透传 props、层级和关闭模式', async () => {
    const fixture = shadowUi();
    const app = {mount: vi.fn(() => null), unmount: vi.fn()};
    mocks.createApp.mockReturnValue(app);
    mocks.createShadowRootUi.mockResolvedValue(fixture.ui);
    const props = {label: '测试'};

    await createVueShadowUi({} as never, {
      name: 'closed-ui',
      hostId: 'closed-host',
      component: {name: 'ClosedFixture'},
      props,
      zIndex: 99,
      mode: 'closed',
    });

    const [, options] = mocks.createShadowRootUi.mock.calls[0];
    options.onMount({});
    expect(options).toEqual(expect.objectContaining({zIndex: 99, mode: 'closed'}));
    expect(mocks.createApp).toHaveBeenCalledWith({name: 'ClosedFixture'}, props);
  });

  it('保留 WXT 创建失败，让 feature 运行时决定如何降级', async () => {
    mocks.createShadowRootUi.mockRejectedValue(new Error('shadow unavailable'));

    await expect(createVueShadowUi({} as never, {
      name: 'failed-ui',
      hostId: 'failed-host',
      component: {name: 'FailedFixture'},
    })).rejects.toThrow('shadow unavailable');
  });
});
